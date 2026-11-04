const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHmac, randomUUID } = require('node:crypto');
const { TableClient } = require('@azure/data-tables');
const codes = require('./coupon-code');
const {
  award, initialize, getClient, getSecret, verifyCoupon, redeemCoupon, PARTITION, STOCK
} = require('./table-store');

const secret = 'test-only-identity-secret-32-bytes-long';
const participant = {
  fullName: 'Test', nickname: 'Tester', company: 'Test company',
  phone: '01000000000', email: 'test@example.com', jobRole: '개발',
  consent: true, score: 100, bugs: 10
};

function serviceError(statusCode) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

class MemoryTable {
  rows = new Map();
  async createTable() {}
  async getEntity(partition, rowKey) {
    if (!this.rows.has(rowKey)) throw serviceError(404);
    return { ...this.rows.get(rowKey) };
  }
  async createEntity(entity) {
    if (this.rows.has(entity.rowKey)) throw serviceError(409);
    this.rows.set(entity.rowKey, { ...entity, etag: randomUUID() });
  }
  async *listEntities(options = {}) {
    const code = options.queryOptions?.filter?.match(/couponCode eq '([^']+)'/)?.[1];
    for (const row of this.rows.values()) {
      if (code === undefined || row.couponCode === code) yield { ...row };
    }
  }
  async updateEntity(entity, mode, options) {
    assert.equal(mode, 'Merge');
    const current = this.rows.get(entity.rowKey);
    if (!current) throw serviceError(404);
    if (!options.etag || options.etag === '*' || current.etag !== options.etag) throw serviceError(412);
    this.rows.set(entity.rowKey, { ...current, ...entity, etag: randomUUID() });
  }
  async deleteEntity(partition, rowKey) {
    this.rows.delete(rowKey);
  }
  async submitTransaction(actions) {
    const [update, ...creates] = actions;
    assert.equal(update[0], 'update');
    assert.equal(update[2], 'Replace');
    for (const create of creates) {
      assert.equal(create[0], 'create');
      assert.equal(update[1].partitionKey, create[1].partitionKey);
    }
    const current = this.rows.get(update[1].rowKey);
    if (!current) throw serviceError(404);
    if (current.etag !== update[3].etag) throw serviceError(412);
    for (const create of creates) {
      if (this.rows.has(create[1].rowKey)) throw serviceError(409);
    }
    this.rows.set(update[1].rowKey, { ...update[1], etag: randomUUID() });
    for (const create of creates) {
      this.rows.set(create[1].rowKey, { ...create[1], etag: randomUUID() });
    }
  }
}

async function makeTable(t, seed = true) {
  const connection = process.env.AZURITE_TEST_CONNECTION;
  let client;
  if (connection) {
    // Only isolated test tables are created/deleted, never the production table.
    client = TableClient.fromConnectionString(connection,
      `Test${randomUUID().replaceAll('-', '')}`, { allowInsecureConnection: true });
    await client.createTable();
    t.after(() => client.deleteTable());
  } else {
    client = new MemoryTable();
  }
  if (seed) await initialize(client, secret);
  return client;
}

async function rows(client) {
  const result = [];
  for await (const entity of client.listEntities()) result.push(entity);
  return result;
}

test('initialization creates exactly 500 prizes and is idempotent without restocking', async (t) => {
  const client = await makeTable(t);
  const original = await client.getEntity(PARTITION, 'inventory');
  assert.equal(original.awarded, 0);
  for (const key of Object.keys(STOCK)) assert.equal(original[key], STOCK[key]);
  await award(client, participant, secret);
  await initialize(client, secret);
  const inventory = await client.getEntity(PARTITION, 'inventory');
  assert.equal(inventory.awarded, 1);
  assert.equal(Object.keys(STOCK).reduce((sum, key) => sum + inventory[key], 0), 499);
});

test('stored row includes full phone, last four and all participant/coupon information', async (t) => {
  const client = await makeTable(t);
  const result = await award(client, participant, secret);
  const id = createHmac('sha256', secret).update(participant.phone).digest('hex');
  const winner = await client.getEntity(PARTITION, `winner-${id}`);
  for (const [key, value] of Object.entries(participant)) assert.equal(winner[key], value);
  assert.equal(winner.phoneLast4, '0000');
  assert.equal(winner.participantId, id);
  assert.equal(winner.redeemed, false);
  assert.equal(winner.couponCode, result.code);
  assert.equal(winner.prizeKey, result.prizeKey);
  assert.equal(winner.wonAt, result.wonAt);
  assert.equal(result.phone, undefined);
  assert.equal(result.participantId, undefined);
  assert.equal(result.email, undefined);
  assert.equal(result.mailed, false);
});

test('simultaneous same-number requests create one coupon and decrement stock once', async (t) => {
  const client = await makeTable(t);
  const responses = await Promise.all(Array.from({ length: 12 }, () =>
    award(client, participant, secret)));
  assert.equal(new Set(responses.map((result) => result.code)).size, 1);
  assert.equal(responses.filter((result) => result.status === 'awarded').length, 1);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
  assert.equal((await rows(client)).length, 3);
  const retry = await award(client, { ...participant, nickname: 'Changed' }, secret);
  assert.equal(retry.nickname, participant.nickname);
  assert.equal(retry.status, 'duplicate');
});

test('different phones with identical last four do not collide', async (t) => {
  const client = await makeTable(t);
  const first = await award(client, participant, secret);
  const second = await award(client, { ...participant, phone: '01011110000' }, secret);
  assert.notEqual(first.code, second.code);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 2);
});

test('concurrent distinct participants preserve stock and all committed coupons', async (t) => {
  const client = await makeTable(t);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    award(client, { ...participant, phone: `010${String(i).padStart(8, '0')}` }, secret)));
  assert.equal(new Set(results.map((result) => result.code)).size, 8);
  const inventory = await client.getEntity(PARTITION, 'inventory');
  assert.equal(inventory.awarded, 8);
  assert.equal(Object.keys(STOCK).reduce((sum, key) => sum + inventory[key], 0), 492);
  assert.equal((await rows(client)).length, 17);
});

test('500 awards exhaust exact quotas; 501st is rejected and duplicates still restore', async (t) => {
  const client = await makeTable(t);
  const counts = Object.fromEntries(Object.keys(STOCK).map((key) => [key, 0]));
  let first;
  const issuedCodes = new Set();
  for (let i = 0; i < 500; i++) {
    const result = await award(client, { ...participant, phone: `010${String(i).padStart(8, '0')}` }, secret);
    first ??= result;
    assert.match(result.code, /^[A-Z0-9]{8}$/);
    issuedCodes.add(result.code);
    counts[result.prizeKey]++;
  }
  assert.deepEqual(counts, STOCK);
  assert.equal(issuedCodes.size, 500);
  await assert.rejects(award(client, { ...participant, phone: '01099999999' }, secret),
    { code: 'sold_out', status: 409 });
  const duplicate = await award(client, participant, secret);
  assert.equal(duplicate.code, first.code);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal((await rows(client)).length, 1001);
});

test('redeemed coupons still count against stock and never create a new award', async (t) => {
  const client = await makeTable(t);
  const first = await award(client, participant, secret);
  const winner = (await rows(client)).find((row) => row.kind === 'winner');
  if (client instanceof MemoryTable) {
    client.rows.set(winner.rowKey, { ...winner, redeemed: true });
  } else {
    await client.updateEntity({ partitionKey: PARTITION, rowKey: winner.rowKey, redeemed: true },
      'Merge', { etag: winner.etag });
  }
  assert.equal((await award(client, participant, secret)).code, first.code);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
});

test('missing inventory fails closed and cannot be reinitialized over existing records', async (t) => {
  const client = await makeTable(t, false);
  await assert.rejects(award(client, participant, secret), { code: 'table_not_initialized' });
  await client.createEntity({ partitionKey: PARTITION, rowKey: 'winner-existing', kind: 'winner' });
  await assert.rejects(initialize(client, secret), { code: 'inventory_missing_with_records' });
});

test('changing identity secret is rejected instead of permitting duplicate participation', async (t) => {
  const client = await makeTable(t);
  await assert.rejects(award(client, participant, 'different-secret'), { code: 'identity_mismatch' });
  await assert.rejects(initialize(client, 'different-secret'), { code: 'identity_mismatch' });
});

test('corrupt inventory cannot issue a coupon or silently reset stock', async (t) => {
  const client = await makeTable(t);
  const inventory = await client.getEntity(PARTITION, 'inventory');
  if (client instanceof MemoryTable) {
    client.rows.set('inventory', { ...inventory, beer5: -1 });
  } else {
    await client.updateEntity({ partitionKey: PARTITION, rowKey: 'inventory', beer5: -1 },
      'Merge', { etag: inventory.etag });
  }
  await assert.rejects(award(client, participant, secret), { code: 'invalid_inventory' });
  await assert.rejects(initialize(client, secret), { code: 'invalid_inventory' });
  assert.equal((await rows(client)).length, 1);
});

test('stale ETag rejects the entire transaction including the winner creation', async (t) => {
  const client = await makeTable(t);
  const stale = await client.getEntity(PARTITION, 'inventory');
  await award(client, participant, secret);
  await assert.rejects(client.submitTransaction([
    ['update', {
      partitionKey: PARTITION, rowKey: 'inventory',
      ...STOCK, beer1: 434, awarded: 1
    }, 'Replace', { etag: stale.etag }],
    ['create', { partitionKey: PARTITION, rowKey: 'winner-must-not-exist' }]
  ]), (error) => error.statusCode === 412);
  await assert.rejects(client.getEntity(PARTITION, 'winner-must-not-exist'),
    (error) => error.statusCode === 404);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
});

test('transaction failures are propagated without decrementing inventory', async (t) => {
  const client = await makeTable(t);
  t.mock.method(client, 'submitTransaction', async () => { throw serviceError(500); });
  await assert.rejects(award(client, participant, secret), { statusCode: 500 });
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 0);
  assert.equal((await rows(client)).length, 1);
});

test('commit followed by response loss restores the same coupon on retry', async (t) => {
  const client = await makeTable(t);
  const submit = client.submitTransaction.bind(client);
  t.mock.method(client, 'submitTransaction', async (...args) => {
    await submit(...args);
    throw serviceError(500);
  });
  await assert.rejects(award(client, participant, secret), { statusCode: 500 });
  const retry = await award(client, participant, secret);
  assert.equal(retry.status, 'duplicate');
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
});

test('configuration must include connection string and a sufficiently long secret', (t) => {
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const identity = process.env.ROULETTE_IDENTITY_SECRET;
  t.after(() => {
    if (connection === undefined) delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    else process.env.AZURE_STORAGE_CONNECTION_STRING = connection;
    if (identity === undefined) delete process.env.ROULETTE_IDENTITY_SECRET;
    else process.env.ROULETTE_IDENTITY_SECRET = identity;
  });
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  process.env.ROULETTE_IDENTITY_SECRET = 'short';
  assert.throws(getClient, { code: 'not_configured' });
  assert.throws(getSecret, { code: 'not_configured' });
});

test('staff lookup reads a real coupon and exposes only redemption fields', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const verified = await verifyCoupon(client, coupon.code);
  assert.deepEqual(Object.keys(verified).sort(),
    ['code', 'nickname', 'prizeName', 'redeemed', 'redeemedAt', 'wonAt'].sort());
  assert.equal(verified.code, coupon.code);
  assert.equal(verified.nickname, participant.nickname);
  assert.equal(verified.redeemed, false);
  assert.equal(verified.redeemedAt, null);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
});

test('invalid codes cannot inject filters or modify storage', async (t) => {
  const client = await makeTable(t);
  for (const code of [null, '', 'GS-fake', "' or PartitionKey ne ''", 'GS-' + 'a'.repeat(36)]) {
    await assert.rejects(verifyCoupon(client, code), { code: 'invalid_code', status: 400 });
    await assert.rejects(redeemCoupon(client, code), { code: 'invalid_code', status: 400 });
  }
  await assert.rejects(verifyCoupon(client, `GS-${randomUUID()}`),
    { code: 'coupon_not_found', status: 404 });
  await assert.rejects(redeemCoupon(client, `GS-${randomUUID()}`),
    { code: 'coupon_not_found', status: 404 });
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 0);
});

test('redemption persists time and preserves participant fields and exact inventory', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const inventory = await client.getEntity(PARTITION, 'inventory');
  const result = await redeemCoupon(client, coupon.code);
  assert.equal(result.redeemed, true);
  assert.ok(Number.isFinite(Date.parse(result.redeemedAt)));
  assert.deepEqual(await verifyCoupon(client, coupon.code), result);
  assert.deepEqual(await client.getEntity(PARTITION, 'inventory'), inventory);
  const winner = (await rows(client)).find((row) => row.kind === 'winner');
  for (const [key, value] of Object.entries(participant)) assert.equal(winner[key], value);
  await assert.rejects(redeemCoupon(client, coupon.code), { code: 'already_redeemed', status: 409 });
  assert.equal((await award(client, participant, secret)).code, coupon.code);
  await initialize(client, secret);
  assert.deepEqual(await client.getEntity(PARTITION, 'inventory'), inventory);
});

test('concurrent staff redemptions allow exactly one successful confirmation', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
    redeemCoupon(client, coupon.code)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of results.filter((result) => result.status === 'rejected')) {
    assert.equal(result.reason.code, 'already_redeemed');
    assert.equal(result.reason.status, 409);
  }
  assert.equal((await verifyCoupon(client, coupon.code)).redeemed, true);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 1);
});

test('storage update failures never report redemption success', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  t.mock.method(client, 'updateEntity', async () => { throw serviceError(500); });
  await assert.rejects(redeemCoupon(client, coupon.code), { statusCode: 500 });
  assert.equal((await verifyCoupon(client, coupon.code)).redeemed, false);
});

test('lost redemption response can be reconciled by lookup without a second redemption', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const update = client.updateEntity.bind(client);
  t.mock.method(client, 'updateEntity', async (...args) => {
    await update(...args);
    throw serviceError(500);
  });
  await assert.rejects(redeemCoupon(client, coupon.code), { statusCode: 500 });
  assert.equal((await verifyCoupon(client, coupon.code)).redeemed, true);
  await assert.rejects(redeemCoupon(client, coupon.code), { code: 'already_redeemed' });
});

test('ambiguous codes and invalid redemption flags fail closed', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const winner = (await rows(client)).find((row) => row.kind === 'winner');
  await client.createEntity({ ...winner, rowKey: `winner-${'a'.repeat(64)}` });
  await assert.rejects(verifyCoupon(client, coupon.code), { code: 'invalid_coupon' });
  await assert.rejects(redeemCoupon(client, coupon.code), { code: 'invalid_coupon' });
  await client.deleteEntity(PARTITION, `winner-${'a'.repeat(64)}`);
  await client.updateEntity({ partitionKey: PARTITION, rowKey: winner.rowKey, redeemed: 'false' },
    'Merge', { etag: winner.etag });
  await assert.rejects(redeemCoupon(client, coupon.code), { code: 'invalid_coupon' });
});

test('legacy redeemed records without a timestamp still block reuse', async (t) => {
  const client = await makeTable(t);
  const coupon = await award(client, participant, secret);
  const winner = (await rows(client)).find((row) => row.kind === 'winner');
  await client.updateEntity({ partitionKey: PARTITION, rowKey: winner.rowKey, redeemed: true },
    'Merge', { etag: winner.etag });
  assert.equal((await verifyCoupon(client, coupon.code)).redeemedAt, null);
  await assert.rejects(redeemCoupon(client, coupon.code), { code: 'already_redeemed' });
});

test('short code collisions retry atomically without consuming extra inventory', async (t) => {
  const client = await makeTable(t);
  const firstCode = 'K7M2P9Q4', nextCode = 'A1B2C3D4';
  let calls = 0;
  t.mock.method(codes, 'generateCode', () => ++calls <= 2 ? firstCode : nextCode);
  const first = await award(client, participant, secret);
  const second = await award(client, { ...participant, phone: '01011112222' }, secret);
  assert.equal(first.code, firstCode);
  assert.equal(second.code, nextCode);
  assert.equal(calls, 3);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 2);
  assert.equal((await rows(client)).length, 5);
  assert.equal((await verifyCoupon(client, firstCode)).nickname, participant.nickname);
});

test('legacy GS coupons restore and redeem unchanged alongside new short codes', async (t) => {
  const client = await makeTable(t);
  const first = await award(client, participant, secret);
  const id = createHmac('sha256', secret).update(participant.phone).digest('hex');
  const winner = await client.getEntity(PARTITION, `winner-${id}`);
  const legacy = `GS-${randomUUID()}`;
  await client.updateEntity({ partitionKey: PARTITION, rowKey: winner.rowKey, couponCode: legacy },
    'Merge', { etag: winner.etag });
  await client.deleteEntity(PARTITION, `coupon-${first.code}`);
  assert.equal((await award(client, participant, secret)).code, legacy);
  assert.equal((await verifyCoupon(client, legacy)).code, legacy);
  assert.equal((await redeemCoupon(client, legacy)).redeemed, true);
  const next = await award(client, { ...participant, phone: '01011112222' }, secret);
  assert.match(next.code, /^[A-Z0-9]{8}$/);
  assert.equal((await client.getEntity(PARTITION, 'inventory')).awarded, 2);
});

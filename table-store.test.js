const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHmac, randomUUID } = require('node:crypto');
const { TableClient } = require('@azure/data-tables');
const { award, initialize, getClient, getSecret, PARTITION, STOCK } = require('./table-store');

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
  async *listEntities() {
    for (const row of this.rows.values()) yield { ...row };
  }
  async deleteEntity(partition, rowKey) {
    this.rows.delete(rowKey);
  }
  async submitTransaction(actions) {
    const [update, create] = actions;
    assert.equal(update[0], 'update');
    assert.equal(update[2], 'Replace');
    assert.equal(create[0], 'create');
    assert.equal(update[1].partitionKey, create[1].partitionKey);
    const current = this.rows.get(update[1].rowKey);
    if (!current) throw serviceError(404);
    if (current.etag !== update[3].etag) throw serviceError(412);
    if (this.rows.has(create[1].rowKey)) throw serviceError(409);
    this.rows.set(update[1].rowKey, { ...update[1], etag: randomUUID() });
    this.rows.set(create[1].rowKey, { ...create[1], etag: randomUUID() });
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
  assert.equal((await rows(client)).length, 2);
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
  assert.equal((await rows(client)).length, 9);
});

test('500 awards exhaust exact quotas; 501st is rejected and duplicates still restore', async (t) => {
  const client = await makeTable(t);
  const counts = Object.fromEntries(Object.keys(STOCK).map((key) => [key, 0]));
  let first;
  for (let i = 0; i < 500; i++) {
    const result = await award(client, { ...participant, phone: `010${String(i).padStart(8, '0')}` }, secret);
    first ??= result;
    counts[result.prizeKey]++;
  }
  assert.deepEqual(counts, STOCK);
  await assert.rejects(award(client, { ...participant, phone: '01099999999' }, secret),
    { code: 'sold_out', status: 409 });
  const duplicate = await award(client, participant, secret);
  assert.equal(duplicate.code, first.code);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal((await rows(client)).length, 501);
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

const { TableClient } = require('@azure/data-tables');
const { createHmac, randomInt } = require('node:crypto');
const codes = require('./coupon-code');
const { setTimeout: delay } = require('node:timers/promises');

const PARTITION = 'GSTAR2026';
const TABLE = 'GSTARRoulette';
const STOCK = { beer5: 15, nachos: 30, quesa: 20, beer1: 435 };
const NAMES = { beer5: '맥주 5잔 세트', nachos: '나초', quesa: '퀘사디아', beer1: '맥주 1잔' };

class RouletteError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function getSecret() {
  const secret = process.env.ROULETTE_IDENTITY_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new RouletteError('not_configured');
  return secret;
}

function getClient() {
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connection) throw new RouletteError('not_configured');
  return TableClient.fromConnectionString(connection, TABLE, {
    retryOptions: { maxRetries: 2, maxRetryDelayInMs: 1000 },
    allowInsecureConnection: connection === 'UseDevelopmentStorage=true'
  });
}

function fingerprint(secret) {
  return createHmac('sha256', secret).update('GSTAR2026-identity-key-check').digest('hex');
}

async function find(client, rowKey) {
  try {
    return await client.getEntity(PARTITION, rowKey, { requestOptions: { timeout: 3000 } });
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

function validateInventory(inventory, secret) {
  if (!inventory) throw new RouletteError('table_not_initialized');
  if (inventory.identityFingerprint !== fingerprint(secret)) {
    throw new RouletteError('identity_mismatch');
  }
  let remaining = 0;
  for (const [key, capacity] of Object.entries(STOCK)) {
    if (!Number.isInteger(inventory[key]) || inventory[key] < 0 || inventory[key] > capacity) {
      throw new RouletteError('invalid_inventory');
    }
    remaining += inventory[key];
  }
  if (!Number.isInteger(inventory.awarded) || inventory.awarded < 0 ||
    remaining + inventory.awarded !== 500) {
    throw new RouletteError('invalid_inventory');
  }
  return remaining;
}

function publicCoupon(winner, status) {
  if (!Object.hasOwn(STOCK, winner.prizeKey) ||
    !codes.validCode(winner.couponCode) ||
    typeof winner.wonAt !== 'string' || !Number.isFinite(Date.parse(winner.wonAt)) ||
    typeof winner.nickname !== 'string' || !winner.nickname || winner.nickname.length > 20 ||
    typeof winner.company !== 'string' || !winner.company || winner.company.length > 40) {
    throw new RouletteError('invalid_coupon');
  }
  return {
    status, code: winner.couponCode, prizeKey: winner.prizeKey,
    wonAt: winner.wonAt, nickname: winner.nickname, company: winner.company,
    mailed: winner.mailed === true
  };
}

async function award(client, participant, secret) {
  const participantId = createHmac('sha256', secret).update(participant.phone).digest('hex');
  const rowKey = `winner-${participantId}`;
  const deadline = Date.now() + 22000;

  for (let attempt = 0; attempt < 30 && Date.now() < deadline; attempt++) {
    const inventory = await find(client, 'inventory');
    const total = validateInventory(inventory, secret);
    const existing = await find(client, rowKey);
    if (existing) return publicCoupon(existing, 'duplicate');
    if (!total) throw new RouletteError('sold_out', 409);

    let ticket = randomInt(total);
    const prizeKey = Object.keys(STOCK).find((key) => {
      ticket -= inventory[key];
      return ticket < 0;
    });
    const winner = {
      partitionKey: PARTITION, rowKey, kind: 'winner',
      ...participant, participantId, phoneLast4: participant.phone.slice(-4),
      couponCode: codes.generateCode(), prizeKey, prizeName: NAMES[prizeKey],
      redeemed: false, wonAt: new Date().toISOString()
    };

    try {
      // Reserve the short code atomically with stock and winner to prevent collisions.
      await client.submitTransaction([
        ['update', {
          partitionKey: PARTITION, rowKey: 'inventory', kind: 'inventory',
          identityFingerprint: inventory.identityFingerprint,
          ...Object.fromEntries(Object.keys(STOCK).map((key) =>
            [key, inventory[key] - (key === prizeKey ? 1 : 0)])),
          awarded: inventory.awarded + 1
        }, 'Replace', { etag: inventory.etag }],
        ['create', winner],
        ['create', {
          partitionKey: PARTITION, rowKey: `coupon-${winner.couponCode}`,
          kind: 'coupon-code', winnerRowKey: rowKey
        }]
      ], { requestOptions: { timeout: 3000 } });
      return publicCoupon(winner, 'awarded');
    } catch (error) {
      if (error.statusCode !== 409 && error.statusCode !== 412) throw error;
      await delay(randomInt(10, 100));
    }
  }
  throw new RouletteError('storage_busy');
}

async function initialize(client, secret) {
  await client.createTable();
  const existing = await find(client, 'inventory');
  if (existing) {
    validateInventory(existing, secret);
    return;
  }
  // Never recreate stock when winner records survive a missing inventory row.
  for await (const entity of client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'` }
  })) {
    if (entity) throw new RouletteError('inventory_missing_with_records');
  }
  try {
    await client.createEntity({
      partitionKey: PARTITION, rowKey: 'inventory', kind: 'inventory',
      identityFingerprint: fingerprint(secret), ...STOCK, awarded: 0
    });
  } catch (error) {
    if (error.statusCode !== 409) throw error;
    validateInventory(await find(client, 'inventory'), secret);
  }
}

async function readiness() {
  const inventory = await find(getClient(), 'inventory');
  validateInventory(inventory, getSecret());
}

function staffCoupon(winner) {
  const coupon = publicCoupon(winner, 'verified');
  if (winner.kind !== 'winner' || !/^winner-[a-f0-9]{64}$/.test(winner.rowKey) ||
    typeof winner.redeemed !== 'boolean' ||
    (winner.redeemedAt !== undefined &&
      (typeof winner.redeemedAt !== 'string' || !Number.isFinite(Date.parse(winner.redeemedAt))))) {
    throw new RouletteError('invalid_coupon');
  }
  return {
    code: coupon.code, prizeName: NAMES[winner.prizeKey],
    nickname: coupon.nickname, wonAt: coupon.wonAt,
    redeemed: winner.redeemed, redeemedAt: winner.redeemedAt || null
  };
}

async function findCoupon(client, code) {
  if (!codes.validCode(code)) {
    throw new RouletteError('invalid_code', 400);
  }
  let winner;
  for await (const entity of client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}' and couponCode eq '${code}'` },
    requestOptions: { timeout: 3000 }
  })) {
    if (winner) throw new RouletteError('invalid_coupon');
    winner = entity;
  }
  if (!winner) throw new RouletteError('coupon_not_found', 404);
  staffCoupon(winner);
  if (winner.partitionKey !== PARTITION || winner.couponCode !== code ||
    typeof winner.etag !== 'string' || !winner.etag || winner.etag === '*') {
    throw new RouletteError('invalid_coupon');
  }
  return winner;
}

async function verifyCoupon(client, code) {
  return staffCoupon(await findCoupon(client, code));
}

async function redeemCoupon(client, code) {
  const winner = await findCoupon(client, code);
  if (winner.redeemed) throw new RouletteError('already_redeemed', 409);
  const redeemedAt = new Date().toISOString();
  try {
    // Never use a wildcard ETag: only one staff member can redeem this version.
    await client.updateEntity({
      partitionKey: PARTITION, rowKey: winner.rowKey, redeemed: true, redeemedAt
    }, 'Merge', { etag: winner.etag, requestOptions: { timeout: 3000 } });
  } catch (error) {
    if (error.statusCode === 412) {
      const latest = await findCoupon(client, code);
      throw new RouletteError(latest.redeemed ? 'already_redeemed' : 'coupon_changed', 409);
    }
    throw error;
  }
  return staffCoupon({ ...winner, redeemed: true, redeemedAt });
}

async function markMailed(client, code) {
  const winner = await findCoupon(client, code);
  if (winner.mailed === true) return;
  try {
    await client.updateEntity({
      partitionKey: PARTITION, rowKey: winner.rowKey, mailed: true
    }, 'Merge', { etag: winner.etag, requestOptions: { timeout: 3000 } });
  } catch (error) {
    if (error.statusCode !== 412) throw error;
    console.warn('Coupon mail flag changed concurrently; mailed flag not saved.');
  }
}

if (require.main === module) {
  Promise.resolve().then(() => initialize(getClient(), getSecret())).then(() => {
    console.log('Azure roulette table initialized; existing stock was not reset.');
  }).catch((error) => {
    console.error(`Table setup failed (${error instanceof RouletteError ? error.code : error.name}).`);
    process.exitCode = 1;
  });
}

module.exports = {
  getClient, getSecret, award, initialize, readiness, verifyCoupon, redeemCoupon, markMailed,
  RouletteError, PARTITION, STOCK, NAMES
};

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { createHmac } = require('node:crypto');
const { before, after, test } = require('node:test');
const server = require('./server');
const store = require('./table-store');

const password = 'test-only-staff-password-32-bytes-long';
const coupon = {
  code: 'GS-00000000-0000-0000-0000-000000000000', prizeName: '맥주 1잔',
  nickname: 'Tester', wonAt: '2026-11-04T03:00:00Z', redeemed: false, redeemedAt: null
};
let baseUrl;
let cookie;
const originalPassword = process.env.ROULETTE_STAFF_PASSWORD;

function post(route, data, session = cookie, headers = {}) {
  return fetch(`${baseUrl}/api/staff/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Staff-Request': '1',
      ...(session ? { Cookie: session } : {}), ...headers
    },
    body: JSON.stringify(data)
  });
}

before(async () => {
  process.env.ROULETTE_STAFF_PASSWORD = password;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await post('login', { password }, null);
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  if (originalPassword === undefined) delete process.env.ROULETTE_STAFF_PASSWORD;
  else process.env.ROULETTE_STAFF_PASSWORD = originalPassword;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('staff page is public but contains no password and cannot be cached or framed', async () => {
  const response = await fetch(`${baseUrl}/staff`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const page = await response.text();
  assert.equal(page, readFileSync(`${__dirname}/staff.html`, 'utf8'));
  assert.ok(!page.includes(password));
  assert.equal((await fetch(`${baseUrl}/staff`, { method: 'HEAD' })).status, 200);
  for (const path of ['/staff-api.js', '/staff.html']) {
    assert.equal((await fetch(baseUrl + path)).status, 404);
  }
});

test('unauthenticated requests cannot inspect or modify coupons', async (t) => {
  t.mock.method(store, 'getClient', () => assert.fail('Storage must not be accessed'));
  for (const route of ['verify', 'redeem', 'logout']) {
    const response = await post(route, { code: coupon.code }, null);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  }
  assert.equal((await fetch(`${baseUrl}/api/staff/session`)).status, 401);
});

test('login rejects wrong passwords and issues an HttpOnly HTTPS session', async () => {
  for (const input of [null, {}, { password: 'wrong' }]) {
    assert.equal((await post('login', input, null)).status, 401);
  }
  const response = await post('login', { password }, null, { 'X-Forwarded-Proto': 'https' });
  assert.equal(response.status, 200);
  const header = response.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=28800/);
  assert.ok(!header.includes(password));
  assert.deepEqual(await response.json(), { authenticated: true });
});

test('valid session works but tampered and expired sessions are rejected', async () => {
  const session = await fetch(`${baseUrl}/api/staff/session`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  for (const invalid of ['gstar_staff=garbage', cookie.replace(/.$/, 'x'),
    'gstar_staff=' + 'a'.repeat(300)]) {
    assert.equal((await post('verify', { code: coupon.code }, invalid)).status, 401);
  }
  const value = `${Date.now() - 1000}.${'a'.repeat(32)}`;
  const mac = createHmac('sha256', password).update(`staff-session:${value}`).digest('hex');
  assert.equal((await post('verify', { code: coupon.code }, `gstar_staff=${value}.${mac}`)).status, 401);
});

test('rotating the staff password invalidates existing sessions', async (t) => {
  t.after(() => { process.env.ROULETTE_STAFF_PASSWORD = password; });
  process.env.ROULETTE_STAFF_PASSWORD = 'new-test-password-32-bytes-long';
  assert.equal((await post('verify', { code: coupon.code })).status, 401);
});

test('missing or weak staff configuration fails explicitly', async (t) => {
  t.after(() => { process.env.ROULETTE_STAFF_PASSWORD = password; });
  for (const value of ['', 'short', '@Microsoft.KeyVault(SecretUri=private)']) {
    process.env.ROULETTE_STAFF_PASSWORD = value;
    const response = await post('login', { password }, null);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'staff_not_configured' });
  }
});

test('logout expires the browser cookie', async () => {
  const response = await post('logout', {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /gstar_staff=;/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await response.json(), { authenticated: false });
});

test('authenticated lookup and redemption use storage and normalize the code', async (t) => {
  t.mock.method(store, 'getClient', () => ({}));
  t.mock.method(store, 'verifyCoupon', async (client, code) => {
    assert.equal(code, coupon.code);
    return coupon;
  });
  t.mock.method(store, 'redeemCoupon', async (client, code) => {
    assert.equal(code, coupon.code);
    return { ...coupon, redeemed: true, redeemedAt: '2026-11-04T04:00:00Z' };
  });
  assert.deepEqual(await (await post('verify', { code: ` ${coupon.code.toLowerCase()} ` })).json(),
    { coupon });
  const response = await post('redeem', { code: coupon.code });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).coupon.redeemed, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('storage errors and conflicts are explicit and do not expose private details', async (t) => {
  t.mock.method(store, 'getClient', () => ({}));
  for (const [error, status, code] of [
    [new store.RouletteError('coupon_not_found', 404), 404, 'coupon_not_found'],
    [new store.RouletteError('already_redeemed', 409), 409, 'already_redeemed'],
    [new store.RouletteError('coupon_changed', 409), 409, 'coupon_changed'],
    [new store.RouletteError('invalid_coupon'), 503, 'invalid_coupon'],
    [new Error('private connection string'), 503, 'storage_failed']
  ]) {
    t.mock.method(store, 'redeemCoupon', async () => { throw error; });
    const response = await post('redeem', { code: coupon.code });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test('eight-character staff codes accept lowercase entry and preserve uppercase identifiers', async (t) => {
  t.mock.method(store, 'getClient', () => ({}));
  t.mock.method(store, 'verifyCoupon', async (client, code) => {
    assert.equal(code, 'K7M2P9Q4');
    return { ...coupon, code };
  });
  t.mock.method(store, 'redeemCoupon', async (client, code) => {
    assert.equal(code, 'K7M2P9Q4');
    return { ...coupon, code, redeemed: true };
  });
  assert.equal((await (await post('verify', { code: ' k7m2p9q4 ' })).json()).coupon.code, 'K7M2P9Q4');
  assert.equal((await (await post('redeem', { code: 'k7m2p9q4' })).json()).coupon.redeemed, true);
});

test('staff API rejects cross-origin browser submissions, unsupported methods and bad bodies', async () => {
  assert.equal((await post('redeem', { code: coupon.code }, cookie,
    { 'X-Staff-Request': '' })).status, 403);
  assert.equal((await post('redeem', {}, cookie, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('redeem', { code: 'a'.repeat(1024) })).status, 413);
  const malformed = await fetch(`${baseUrl}/api/staff/redeem`, {
    method: 'POST', headers: {
      Cookie: cookie, 'Content-Type': 'application/json', 'X-Staff-Request': '1'
    }, body: '{'
  });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(`${baseUrl}/api/staff/redeem`, { method: 'OPTIONS' })).status, 405);
  const response = await fetch(`${baseUrl}/api/staff/redeem`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal((await fetch(`${baseUrl}/api/staff/missing`)).status, 404);
});

test('login attempts are limited with a retry interval', async (t) => {
  t.mock.method(Date, 'now', () => 2000000000000);
  for (let i = 0; i < 20; i++) {
    assert.equal((await post('login', { password: 'wrong' }, null)).status, 401);
  }
  const limited = await post('login', { password }, null);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.deepEqual(await limited.json(), { error: 'too_many_attempts' });
  t.mock.method(Date, 'now', () => 2000000060001);
  assert.equal((await post('login', { password }, null)).status, 200);
});

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const { before, after, test } = require('node:test');
const server = require('./server');
const store = require('./table-store');

let baseUrl;
const homepage = readFileSync(`${__dirname}/index.html`, 'utf8');

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

for (const route of ['/', '/index.html', '/?source=azure']) {
  test(`${route} serves the homepage`, async () => {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), homepage);
  });
}

test('HEAD returns homepage headers without a body', async () => {
  const response = await fetch(baseUrl, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(homepage));
  assert.equal(await response.text(), '');
});

for (const route of ['/missing', '/server.js', '/table-store.js', '/roulette.js',
  '/package.json', '/.git/config', '/%2e%2e/README.md']) {
  test(`${route} is not served`, async () => {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Not Found');
  });
}

test('unsupported homepage methods return 405', async () => {
  const response = await fetch(baseUrl, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

const participant = {
  fullName: 'Test', nickname: 'Tester', company: 'Test company',
  phone: '010-0000-0000', email: 'test@example.com', jobRole: '개발',
  consent: true, score: 100, bugs: 10
};
const award = {
  status: 'awarded', code: 'GS-00000000-0000-0000-0000-000000000000',
  prizeKey: 'beer1', nickname: 'Original', company: 'Original company',
  wonAt: '2026-11-04T03:00:00Z', mailed: false
};

function configureStore(t, handler) {
  t.mock.method(store, 'getClient', () => ({}));
  t.mock.method(store, 'getSecret', () => 'a'.repeat(32));
  t.mock.method(store, 'award', handler);
}

function postDraw(input = participant) {
  return fetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

test('roulette passes normalized participant to Table store without exposing phone', async (t) => {
  let stored;
  configureStore(t, async (client, input, secret) => {
    stored = input;
    assert.equal(secret, 'a'.repeat(32));
    return award;
  });
  const response = await postDraw();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(stored.phone, '01000000000');
  assert.equal(stored.consent, true);
  assert.deepEqual(await response.json(), award);
});

test('duplicate coupon is returned unchanged', async (t) => {
  configureStore(t, async () => ({ ...award, status: 'duplicate' }));
  const response = await postDraw({ ...participant, nickname: 'Changed' });
  assert.deepEqual(await response.json(), { ...award, status: 'duplicate' });
});

test('invalid inputs do not reach storage', async (t) => {
  configureStore(t, () => assert.fail('Storage must not be called'));
  for (const input of [null, {}, { ...participant, consent: false },
    { ...participant, phone: '0000' }, { ...participant, score: -1 },
    { ...participant, bugs: 1.5 }, { ...participant, nickname: 'x'.repeat(21) }]) {
    assert.equal((await postDraw(input)).status, 400);
  }
});

for (const [code, status] of [
  ['sold_out', 409], ['not_configured', 503], ['table_not_initialized', 503],
  ['identity_mismatch', 503], ['storage_busy', 503], ['invalid_inventory', 503]
]) {
  test(`${code} returns an explicit error, never a coupon`, async (t) => {
    configureStore(t, async () => { throw new store.RouletteError(code, status); });
    const response = await postDraw();
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  });
}

test('unexpected storage errors are retryable and do not expose secrets', async (t) => {
  configureStore(t, async () => { throw new Error('private connection string'); });
  const response = await postDraw();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'storage_failed' });
});

test('roulette rejects malformed JSON, oversized payloads, content types and methods', async () => {
  const malformed = await fetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert.equal(malformed.status, 400);
  const unsupported = await fetch(`${baseUrl}/api/roulette`, { method: 'POST', body: '{}' });
  assert.equal(unsupported.status, 415);
  const method = await fetch(`${baseUrl}/api/roulette`);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  const oversized = await fetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(5000)
  });
  assert.equal(oversized.status, 413);
});

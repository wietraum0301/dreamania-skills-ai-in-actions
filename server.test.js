const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const { before, after, test } = require('node:test');
const server = require('./server');
const realFetch = global.fetch;
const { createHmac } = require('node:crypto');

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
  test(`${route} serves the unchanged homepage`, async () => {
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

for (const route of ['/missing', '/server.js', '/package.json', '/.git/config', '/%2e%2e/README.md']) {
  test(`${route} is not served`, async () => {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Not Found');
  });
}

test('unsupported methods return 405', async () => {
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

function configureBackend(t, handler) {
  const originalUrl = process.env.ROULETTE_API_URL;
  const originalSecret = process.env.ROULETTE_IDENTITY_SECRET;
  process.env.ROULETTE_API_URL = 'https://example.com/flow?sig=test';
  process.env.ROULETTE_IDENTITY_SECRET = 'a'.repeat(32);
  t.after(() => {
    if (originalUrl === undefined) delete process.env.ROULETTE_API_URL;
    else process.env.ROULETTE_API_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.ROULETTE_IDENTITY_SECRET;
    else process.env.ROULETTE_IDENTITY_SECRET = originalSecret;
  });
  t.mock.method(global, 'fetch', handler);
}

function postDraw(input = participant) {
  return realFetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
}

test('roulette forwards normalized full phone and HMAC ID only to backend', async (t) => {
  let forwarded;
  configureBackend(t, async (url, options) => {
    assert.equal(url.protocol, 'https:');
    assert.equal(options.redirect, 'error');
    forwarded = JSON.parse(options.body);
    return Response.json(award);
  });
  const response = await postDraw();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(forwarded.phone, '01000000000');
  assert.equal(forwarded.phoneLast4, '0000');
  assert.equal(forwarded.participantId, createHmac('sha256', 'a'.repeat(32)).update('01000000000').digest('hex'));
  const result = await response.json();
  assert.deepEqual(result, award);
  assert.equal(result.phone, undefined);
  assert.equal(result.participantId, undefined);
});

test('retry sends the same identity and preserves original duplicate coupon', async (t) => {
  const ids = [];
  configureBackend(t, async (url, options) => {
    ids.push(JSON.parse(options.body).participantId);
    return Response.json({ ...award, status: 'duplicate' });
  });
  const first = await (await postDraw()).json();
  const second = await (await postDraw({ ...participant, nickname: 'Changed' })).json();
  assert.deepEqual(first, second);
  assert.equal(first.nickname, 'Original');
  assert.equal(ids[0], ids[1]);
});

test('different numbers with identical last four have different identities', async (t) => {
  const ids = [];
  configureBackend(t, async (url, options) => {
    ids.push(JSON.parse(options.body).participantId);
    return Response.json(award);
  });
  await postDraw();
  await postDraw({ ...participant, phone: '010-1111-0000' });
  assert.notEqual(ids[0], ids[1]);
});

test('sold out is preserved as 409, never a coupon', async (t) => {
  configureBackend(t, async () => Response.json({ error: 'sold_out' }, { status: 409 }));
  const response = await postDraw();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'sold_out' });
});

test('invalid inputs do not reach backend', async (t) => {
  configureBackend(t, () => assert.fail('Backend must not be called'));
  for (const input of [null, {}, { ...participant, consent: false },
    { ...participant, phone: '0000' }, { ...participant, score: -1 },
    { ...participant, bugs: 1.5 }, { ...participant, nickname: 'x'.repeat(21) }]) {
    assert.equal((await postDraw(input)).status, 400);
  }
});

test('missing configuration returns explicit 503', async (t) => {
  configureBackend(t, () => assert.fail('Backend must not be called'));
  delete process.env.ROULETTE_API_URL;
  const response = await postDraw();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'not_configured' });
});

test('unsafe URL and short identity secret are rejected', async (t) => {
  configureBackend(t, () => assert.fail('Backend must not be called'));
  process.env.ROULETTE_API_URL = 'http://example.com/flow';
  assert.equal((await postDraw()).status, 503);
  process.env.ROULETTE_API_URL = 'https://example.com/flow';
  process.env.ROULETTE_IDENTITY_SECRET = 'short';
  assert.equal((await postDraw()).status, 503);
});

test('malformed backend results and failures do not award coupons', async (t) => {
  const results = [
    Response.json({ ...award, prizeKey: 'constructor' }),
    Response.json({ ...award, code: '<script>' }),
    Response.json({ ...award, wonAt: 'invalid' }),
    Response.json({ ...award, status: 'unknown' }),
    Response.json({ ...award, nickname: null }),
    Response.json(award, { status: 500 }),
    new Response('not JSON')
  ];
  configureBackend(t, async () => results.shift());
  for (let i = 0; i < 7; i++) {
    const response = await postDraw();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'invalid_upstream_response' });
  }
});

test('backend timeout or network failure returns a retryable error', async (t) => {
  configureBackend(t, async () => { throw new DOMException('timeout', 'TimeoutError'); });
  const response = await postDraw();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'upstream_unavailable' });
});

test('roulette rejects malformed JSON and unsupported content type', async () => {
  const malformed = await realFetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
  });
  assert.equal(malformed.status, 400);
  const unsupported = await realFetch(`${baseUrl}/api/roulette`, { method: 'POST', body: '{}' });
  assert.equal(unsupported.status, 415);
  const method = await realFetch(`${baseUrl}/api/roulette`);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  const oversized = await realFetch(`${baseUrl}/api/roulette`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(5000)
  });
  assert.equal(oversized.status, 413);
});

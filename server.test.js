const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const { before, after, test } = require('node:test');
const server = require('./server');

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

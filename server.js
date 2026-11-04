const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const draw = require('./roulette');
const store = require('./table-store');

const homepage = fs.readFileSync(path.join(__dirname, 'index.html'));

const server = http.createServer((request, response) => {
  const pathname = request.url.split('?')[0];
  if (pathname === '/api/roulette/status' && request.method === 'GET') {
    store.readiness().then(() => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ready: true }));
    }).catch((error) => {
      console.error(`Roulette readiness failed (${error.name}).`);
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ready: false }));
    });
    return;
  }
  if (pathname === '/api/roulette') {
    draw(request, response).catch((error) => {
      console.error(`Roulette request failed (${error.name}).`);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        response.destroy();
      }
    });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Method Not Allowed');
    return;
  }

  if (pathname !== '/' && pathname !== '/index.html') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': homepage.length
  });
  response.end(request.method === 'HEAD' ? undefined : homepage);
});

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  server.listen(port, '0.0.0.0', () => {
    console.log(`Listening on port ${port}`);
  });
}

module.exports = server;

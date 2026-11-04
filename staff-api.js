const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const store = require('./table-store');

const COOKIE = 'gstar_staff';
const SESSION_SECONDS = 8 * 60 * 60;
let loginWindow = 0;
let loginAttempts = 0;

function password() {
  const value = process.env.ROULETTE_STAFF_PASSWORD;
  if (!value || Buffer.byteLength(value) < 16 || Buffer.byteLength(value) > 256 ||
    value.startsWith('@Microsoft.KeyVault(')) {
    throw new store.RouletteError('staff_not_configured');
  }
  return value;
}

function signature(value, secret) {
  return createHmac('sha256', secret).update(`staff-session:${value}`).digest('hex');
}

function authorized(request, secret) {
  const token = (request.headers.cookie || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^\d{10,13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expiry, nonce, mac] = token.split('.');
  const expected = signature(`${expiry}.${nonce}`, secret);
  const remaining = Number(expiry) - Date.now();
  return remaining > 0 && remaining <= SESSION_SECONDS * 1000 &&
    timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'));
}

function setCookie(request, response, value, maxAge) {
  const secure = request.socket.encrypted ||
    request.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
  response.setHeader('Set-Cookie',
    `${COOKIE}=${value}; Path=/api/staff; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function reply(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

async function readInput(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new store.RouletteError('invalid_content_type', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new store.RouletteError('payload_too_large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new store.RouletteError('invalid_input', 400);
  }
}

async function handle(request, response, pathname) {
  const routes = {
    '/api/staff/session': 'GET', '/api/staff/login': 'POST',
    '/api/staff/logout': 'POST', '/api/staff/verify': 'POST', '/api/staff/redeem': 'POST'
  };
  if (!Object.hasOwn(routes, pathname)) {
    reply(response, 404, { error: 'not_found' });
    return;
  }
  if (request.method !== routes[pathname]) {
    response.setHeader('Allow', routes[pathname]);
    reply(response, 405, { error: 'method_not_allowed' });
    return;
  }
  // A cross-origin browser cannot send this header without a CORS preflight.
  if (request.method === 'POST' && request.headers['x-staff-request'] !== '1') {
    throw new store.RouletteError('invalid_origin', 403);
  }
  const secret = password();
  if (pathname === '/api/staff/login') {
    const now = Date.now();
    if (now - loginWindow >= 60000) {
      loginWindow = now;
      loginAttempts = 0;
    }
    if (++loginAttempts > 20) {
      response.setHeader('Retry-After', Math.max(1, Math.ceil((loginWindow + 60000 - now) / 1000)));
      throw new store.RouletteError('too_many_attempts', 429);
    }
    const input = await readInput(request);
    if (typeof input?.password !== 'string' ||
      !timingSafeEqual(createHash('sha256').update(input.password).digest(),
        createHash('sha256').update(secret).digest())) {
      throw new store.RouletteError('invalid_password', 401);
    }
    const value = `${now + SESSION_SECONDS * 1000}.${randomBytes(16).toString('hex')}`;
    setCookie(request, response, `${value}.${signature(value, secret)}`, SESSION_SECONDS);
    reply(response, 200, { authenticated: true });
    return;
  }
  if (!authorized(request, secret)) throw new store.RouletteError('unauthorized', 401);
  if (pathname === '/api/staff/session') {
    reply(response, 200, { authenticated: true });
    return;
  }
  if (pathname === '/api/staff/logout') {
    setCookie(request, response, '', 0);
    reply(response, 200, { authenticated: false });
    return;
  }
  const input = await readInput(request);
  const code = typeof input?.code === 'string' ?
    input.code.trim().toLowerCase().replace(/^gs-/, 'GS-') : input?.code;
  const coupon = await (pathname === '/api/staff/redeem' ? store.redeemCoupon : store.verifyCoupon)(
    store.getClient(), code);
  reply(response, 200, { coupon });
}

module.exports = async function staffApi(request, response, pathname) {
  try {
    await handle(request, response, pathname);
  } catch (error) {
    const expected = error instanceof store.RouletteError;
    if (!expected || error.status >= 500) {
      console.error(`Staff coupon operation failed (${expected ? error.code : error.name}).`);
    }
    reply(response, expected ? error.status : 503, {
      error: expected ? error.code : 'storage_failed'
    });
  }
};

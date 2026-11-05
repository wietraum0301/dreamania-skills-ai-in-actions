'use strict';
/* Microsoft Graph 호출 (앱 전용 토큰, client credentials). 외부 패키지 없이 Node 18+ fetch 사용 */
const cfg = require('./config');

class StoreError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

let cachedToken = null;
let tokenExpires = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpires - 60_000) return cachedToken;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`${cfg.authority}/${cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', body });
  if (!r.ok) throw new StoreError('auth_failed', r.status);
  const j = await r.json();
  cachedToken = j.access_token;
  tokenExpires = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return cachedToken;
}

async function graph(method, path, { body, headers } = {}) {
  const h = { Authorization: 'Bearer ' + (await getToken()), Accept: 'application/json', ...(headers || {}) };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(cfg.graphBase + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { status: r.status, ok: r.ok, json };
}

function resetTokenCache() { cachedToken = null; tokenExpires = 0; }

module.exports = { graph, StoreError, resetTokenCache };

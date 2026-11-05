'use strict';
/* Microsoft Graph(SharePoint 목록 + sendMail) 메모리 모의 서버. If-Match/eTag 충돌(412)을 실제처럼 흉내 냄 */
const SITE = 'site-1', WIN = 'win-list', SET = 'set-list';

function setupEnv() {
  Object.assign(process.env, {
    TENANT_ID: 't', CLIENT_ID: 'c', CLIENT_SECRET: 's', SITE_ID: SITE,
    WINNERS_LIST_ID: WIN, SETTINGS_LIST_ID: SET, MAIL_FROM: 'event@example.com',
    GRAPH_BASE: 'https://graph.test/v1.0', AUTHORITY_HOST: 'https://login.test',
  });
}

/* 실제 GSTARWinners 열 (GetListSchema 결과, 2026-11-05). 없는 열·잘못된 형식은 SharePoint처럼 400 */
const WINNER_COLUMNS = {
  Title: 'text', FullName: 'text', Nickname: 'text', Company: 'text', Phone: 'text', Phone4: 'text',
  Email: 'text', JobRole: 'text', PrizeKey: 'text', PrizeName: 'text', CouponCheckedBy: 'text',
  Score: 'number', Bugs: 'number', Redeemed: 'boolean', CouponMailed: 'boolean', Consent: 'boolean',
  WonAt: 'datetime', CouponCheckedAt: 'datetime',
};
const SETTINGS_COLUMNS = { Title: 'text', Label: 'text', NumValue: 'number' };
function badField(columns, fields) {
  for (const [k, v] of Object.entries(fields)) {
    const t = columns[k];
    if (!t) return `Field '${k}' is not recognized`;
    if (t === 'text' && (typeof v !== 'string' || v.length > 255)) return `Field '${k}' must be text <= 255`;
    if (t === 'number' && typeof v !== 'number') return `Field '${k}' must be number`;
    if (t === 'boolean' && typeof v !== 'boolean') return `Field '${k}' must be boolean`;
    if (t === 'datetime' && !/^\d{4}-\d\d-\d\dT/.test(v)) return `Field '${k}' must be ISO datetime`;
  }
  return null;
}

function createMock(settingsInit, opts = {}) {
  const lists = { [WIN]: new Map(), [SET]: new Map() };
  let nextId = 1;
  const add = (list, fields) => { const id = String(nextId++); lists[list].set(id, { id, ver: 1, fields: { ...fields } }); return lists[list].get(id); };
  for (const [k, v] of Object.entries(settingsInit)) add(SET, { Title: k, NumValue: typeof v === 'number' ? v : 0, Label: typeof v === 'string' ? v : '' });
  const etag = (it) => `"{${it.id}},${it.ver}"`;
  const out = (it) => ({ id: it.id, eTag: etag(it), fields: { ...it.fields } });
  const mails = [];
  const stats = { conflicts: 0, calls: 0, rejected: [] };
  const res = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), { status });

  async function fetchMock(url, init = {}) {
    stats.calls++;
    await new Promise((r) => setTimeout(r, Math.random() * (opts.jitter ?? 8)));
    const u = new URL(url);
    const method = init.method || 'GET';
    if (u.host === 'login.test') return res(200, { access_token: 'tok', expires_in: 3600 });
    if (init.headers?.Authorization !== 'Bearer tok') return res(401, {});
    const p = decodeURIComponent(u.pathname).replace('/v1.0', '');
    let m;
    if ((m = p.match(/^\/users\/([^/]+)\/sendMail$/))) {
      if (opts.mailFails) return res(500, { error: { code: 'ErrorSendAsDenied' } });
      mails.push(JSON.parse(init.body)); return res(202);
    }
    if (!(m = p.match(new RegExp(`^/sites/${SITE}/lists/([^/]+)/items(?:/(\\d+))?(/fields)?$`)))) return res(404, {});
    const list = lists[m[1]]; if (!list) return res(404, {});
    const id = m[2];
    if (method === 'GET' && !id) {
      let rows = [...list.values()];
      const f = u.searchParams.get('$filter');
      if (f) {
        const fm = f.match(/^fields\/(\w+) eq '((?:[^']|'')*)'$/);
        if (!fm) return res(400, {});
        rows = rows.filter((r) => String(r.fields[fm[1]]) === fm[2].replace(/''/g, "'"));
      }
      const top = Number(u.searchParams.get('$top') || 100);
      return res(200, { value: rows.slice(0, top).map(out) });
    }
    if (method === 'GET' && id) { const it = list.get(id); return it ? res(200, out(it)) : res(404, {}); }
    if (method === 'PATCH' && id && m[3]) {
      const it = list.get(id); if (!it) return res(404, {});
      const im = init.headers['If-Match'];
      if (im && im !== etag(it)) { stats.conflicts++; return res(412, { error: { code: 'preconditionFailed' } }); }
      const patch = JSON.parse(init.body);
      const bad = badField(m[1] === WIN ? WINNER_COLUMNS : SETTINGS_COLUMNS, patch);
      if (bad) { stats.rejected.push(bad); return res(400, { error: { code: 'invalidRequest', message: bad } }); }
      Object.assign(it.fields, patch); it.ver++;
      return res(200, it.fields);
    }
    if (method === 'POST' && !id) {
      if (opts.createFails) return res(500, {});
      const fields = JSON.parse(init.body).fields;
      const bad = badField(m[1] === WIN ? WINNER_COLUMNS : SETTINGS_COLUMNS, fields);
      if (bad) { stats.rejected.push(bad); return res(400, { error: { code: 'invalidRequest', message: bad } }); }
      const it = add(m[1], fields); return res(201, out(it));
    }
    return res(405, {});
  }

  const setting = (k) => [...lists[SET].values()].find((r) => r.fields.Title === k).fields.NumValue;
  const setValue = (k, v) => { [...lists[SET].values()].find((r) => r.fields.Title === k).fields.NumValue = v; };
  return { fetchMock, lists, mails, stats, setting, setValue, winners: () => [...lists[WIN].values()].map((r) => r.fields) };
}

const BASE_SETTINGS = () => ({
  beer5: 10, nachos: 30, quesa: 20, beer1: 435, expected: 300, played: 0, open: 1, pin: '483920',
  issued_beer5: 0, issued_nachos: 0, issued_quesa: 0, issued_beer1: 0, issued_total: 0,
  redeemed_beer5: 0, redeemed_nachos: 0, redeemed_quesa: 0, redeemed_beer1: 0, redeemed_total: 0, mailed_total: 0,
});

module.exports = { setupEnv, createMock, BASE_SETTINGS };

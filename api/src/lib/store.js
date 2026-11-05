'use strict';
/* SharePoint 목록 접근
   - GSTARWinners : 쿠폰 1장 = 1행 (원본 기록)
   - GSTARSettings: Title = 키, NumValue = 값. issued_* / redeemed_* 카운터가 재고의 기준값입니다.
   카운터는 eTag(If-Match)로 낙관적 잠금을 걸어 동시에 여러 요청이 와도 한정 수량을 넘기지 않습니다. */
const cfg = require('./config');
const { graph, StoreError } = require('./graph');

const PRIZE_KEYS = ['beer5', 'nachos', 'quesa', 'beer1'];
const REQUIRED_KEYS = [
  ...PRIZE_KEYS, 'expected', 'played', 'open', 'pin',
  ...PRIZE_KEYS.map((k) => 'issued_' + k), 'issued_total',
  ...PRIZE_KEYS.map((k) => 'redeemed_' + k), 'redeemed_total',
  'mailed_total',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const odata = (s) => String(s).replace(/'/g, "''");
const listPath = (listId) => `/sites/${cfg.siteId}/lists/${listId}`;

async function getSettings() {
  const r = await graph('GET', `${listPath(cfg.settingsListId)}/items?$expand=fields($select=Title,NumValue,Label)&$top=500`);
  if (r.status === 404) throw new StoreError('not_configured', 404);
  if (!r.ok) throw new StoreError('settings_read_failed', r.status);
  const map = {};
  for (const it of r.json.value || []) {
    const f = it.fields || {};
    if (f.Title) map[f.Title] = { id: String(it.id), value: Number(f.NumValue) || 0, label: f.Label == null ? '' : String(f.Label) };
  }
  const missing = REQUIRED_KEYS.filter((k) => !map[k]);
  if (missing.length) {
    const e = new StoreError('not_configured');
    e.missing = missing;
    throw e;
  }
  return map;
}

async function readItem(listId, id) {
  const r = await graph('GET', `${listPath(listId)}/items/${id}?$expand=fields`);
  if (!r.ok) throw new StoreError('item_read_failed', r.status);
  return { id: String(r.json.id), etag: r.json.eTag, fields: r.json.fields || {} };
}

async function patchFields(listId, id, fields, etag) {
  const headers = etag ? { 'If-Match': etag } : {};
  return graph('PATCH', `${listPath(listId)}/items/${id}/fields`, { body: fields, headers });
}

/* 카운터를 delta만큼 바꿉니다. max를 주면 넘을 때 바꾸지 않고 ok:false. 충돌(412)이면 다시 읽고 재시도 */
async function adjustCounter(settings, key, delta, { max } = {}) {
  const row = settings[key];
  if (!row) throw new StoreError('not_configured');
  for (let attempt = 0; attempt < 12; attempt++) {
    const it = await readItem(cfg.settingsListId, row.id);
    const cur = Number(it.fields.NumValue) || 0;
    if (max !== undefined && cur + delta > max) return { ok: false, value: cur };
    const r = await patchFields(cfg.settingsListId, row.id, { NumValue: cur + delta }, it.etag);
    if (r.ok) { row.value = cur + delta; return { ok: true, value: cur + delta }; }
    if (r.status !== 412 && r.status !== 409) throw new StoreError('settings_write_failed', r.status);
    await sleep(40 + Math.random() * 160);
  }
  throw new StoreError('busy');
}

async function setSetting(settings, key, value) {
  const row = settings[key];
  if (!row) throw new StoreError('not_configured');
  const r = await patchFields(cfg.settingsListId, row.id, { NumValue: value });
  if (!r.ok) throw new StoreError('settings_write_failed', r.status);
  row.value = value;
}

async function findWinners(filter, top = 1) {
  const r = await graph('GET',
    `${listPath(cfg.winnersListId)}/items?$expand=fields&$filter=${encodeURIComponent(filter)}&$top=${top}`,
    { headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' } });
  if (!r.ok) throw new StoreError('winners_read_failed', r.status);
  return (r.json.value || []).map((it) => ({ id: String(it.id), etag: it.eTag, fields: it.fields || {} }));
}

const findByPhone = (phone) => findWinners(`fields/Phone eq '${odata(phone)}'`, 1);
const findByCode = (code) => findWinners(`fields/Title eq '${odata(code)}'`, 1);
const findByPhone4 = (p4) => findWinners(`fields/Phone4 eq '${odata(p4)}'`, 20);

async function createWinner(fields) {
  const r = await graph('POST', `${listPath(cfg.winnersListId)}/items`, { body: { fields } });
  if (!r.ok) throw new StoreError('winner_write_failed', r.status);
  return { id: String(r.json.id), etag: r.json.eTag, fields: r.json.fields || fields };
}

async function updateWinner(id, fields, etag) {
  return patchFields(cfg.winnersListId, id, fields, etag);
}

async function readWinner(id) { return readItem(cfg.winnersListId, id); }

module.exports = {
  PRIZE_KEYS, REQUIRED_KEYS,
  getSettings, adjustCounter, setSetting,
  findByPhone, findByCode, findByPhone4,
  createWinner, updateWinner, readWinner,
};

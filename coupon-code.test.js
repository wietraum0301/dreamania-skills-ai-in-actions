const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { validCode, normalizeCode, generateCode } = require('./coupon-code');

test('new coupon codes are exactly eight uppercase letters and digits without a prefix', () => {
  for (let i = 0; i < 1000; i++) assert.match(generateCode(), /^[A-Z0-9]{8}$/);
});

test('short and legacy codes normalize without changing their identity', () => {
  assert.equal(normalizeCode(' k7m2p9q4 '), 'K7M2P9Q4');
  assert.equal(normalizeCode(' gs-ABCDEF12-0000-0000-0000-000000000000 '),
    'GS-abcdef12-0000-0000-0000-000000000000');
  assert.equal(normalizeCode(null), null);
  assert.equal(validCode('K7M2P9Q4'), true);
  assert.equal(validCode('GS-abcdef12-0000-0000-0000-000000000000'), true);
  for (const code of [null, '', 'ABC1234', 'ABC123456', 'k7m2p9q4', 'K7M-P9Q4', '한글ABC123',
    'GS-' + 'a'.repeat(36), "' OR 1=1"]) assert.equal(validCode(code), false);
});

test('participant coupon recovery accepts both formats and rejects wrong lengths', () => {
  const html = readFileSync(`${__dirname}/index.html`, 'utf8');
  const loadMine = html.slice(html.indexOf('function loadMine(){'), html.indexOf('function saveMine(c){'));
  for (const code of ['K7M2P9Q4', 'GS-abcdef12-0000-0000-0000-000000000000', 'ABC1234', 'ABC123456']) {
    const coupon = {
      code, prizeKey: 'beer1', nickname: 'Tester', company: 'Test company',
      wonAt: '2026-11-04T03:00:00Z'
    };
    const recovered = runInNewContext(`${loadMine}\nloadMine();`, {
      PRIZES: { beer1: {} }, KEY: 'test', console,
      localStorage: { getItem: () => JSON.stringify(coupon) }
    });
    assert.equal(recovered?.code || null, validCode(code) ? code : null);
  }
});

test('staff browser input normalization matches server normalization for both formats', () => {
  const html = readFileSync(`${__dirname}/staff.html`, 'utf8');
  const normalize = html.slice(html.indexOf('function normalizedCode(){'), html.indexOf('function clearResult(){'));
  for (const value of [' k7m2p9q4 ', 'GS-ABCDEF12-0000-0000-0000-000000000000']) {
    const result = runInNewContext(`${normalize}\nnormalizedCode();`, { $: () => ({ value }) });
    assert.equal(result, normalizeCode(value));
  }
});

'use strict';
/* 경품 추첨 (기존 스태프 앱·흐름과 같은 규칙)
   남은 예상 참가자 수 대비 남은 특별 경품 비율로 뽑고, 나머지는 맥주 1잔.
   맥주 1잔이 바닥나면 남은 특별 경품을 대신 지급. 모두 바닥나면 null(소진). */
const { randomInt } = require('crypto');

const PRIZES = {
  beer5: { name: '맥주 5잔 세트', emoji: '🍻' },
  nachos: { name: '나초', emoji: '🌮' },
  quesa: { name: '퀘사디아', emoji: '🫓' },
  beer1: { name: '맥주 1잔', emoji: '🍺' },
};
const SPECIALS = ['beer5', 'nachos', 'quesa'];

function remaining(settings) {
  const rem = {};
  for (const k of Object.keys(PRIZES)) {
    rem[k] = Math.max(0, settings[k].value - settings['issued_' + k].value);
  }
  return rem;
}

function pickPrize(settings, rand = (n) => randomInt(n)) {
  const rem = remaining(settings);
  const total = Object.values(rem).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const left = Math.max(1, settings.expected.value - settings.played.value);
  const r = rand(left);
  let key = 'beer1';
  let acc = 0;
  for (const k of SPECIALS) {
    acc += rem[k];
    if (r < acc) { key = k; break; }
  }
  if (rem[key] === 0) key = ['beer1', ...SPECIALS].find((k) => rem[k] > 0);
  return key;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; /* 헷갈리는 0/O, 1/I 제외 */
function newCouponCode() {
  let s = 'GS-';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

module.exports = { PRIZES, pickPrize, remaining, newCouponCode };

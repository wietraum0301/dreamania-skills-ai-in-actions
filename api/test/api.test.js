'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, createMock, BASE_SETTINGS } = require('./mock-graph');
setupEnv();
const { roulette, staff, _test } = require('../src/lib/handlers');
const { pickPrize } = require('../src/lib/draw');
const { buildCouponMail } = require('../src/lib/mail');

const person = (i, extra = {}) => ({
  fullName: '참가자' + i, nickname: '닉' + i, company: '회사' + i,
  phone: '010-1234-' + String(1000 + i).slice(-4), email: ` User${i}@Example.com `,
  jobRole: '개발', consent: true, score: 120, bugs: 9, ...extra,
});
function use(mock) { global.fetch = mock.fetchMock; _test.failures.clear(); }

test('신규 참가: 쿠폰 생성, 메일 발송, 집계 반영', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const r = await roulette(person(1));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'awarded');
  assert.match(r.body.code, /^GS-[A-Z0-9]{5}$/);
  assert.equal(r.body.mailed, true);
  assert.equal(r.body.emailMasked, 'Us***@Example.com');
  const w = m.winners();
  assert.equal(w.length, 1);
  assert.equal(w[0].Email, 'User1@Example.com');
  assert.equal(w[0].Phone, '010-1234-1001');
  assert.equal(w[0].Phone4, '1001');
  assert.equal(w[0].CouponMailed, true);
  assert.equal(m.setting('issued_' + r.body.prizeKey), 1);
  assert.equal(m.setting('issued_total'), 1);
  assert.equal(m.setting('played'), 1);
  assert.equal(m.setting('mailed_total'), 1);
  assert.equal(m.mails.length, 1);
  assert.equal(m.mails[0].message.toRecipients[0].emailAddress.address, 'User1@Example.com');
});

test('같은 번호 재참여: 기존 쿠폰과 실제 메일·사용 상태 반환, 새 쿠폰 없음', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const a = await roulette(person(2));
  const b = await roulette(person(2, { fullName: '다른이름', email: 'x@y.com' }));
  assert.equal(b.body.status, 'duplicate');
  assert.equal(b.body.code, a.body.code);
  assert.equal(b.body.mailed, true);
  assert.equal(b.body.redeemed, false);
  assert.equal(m.winners().length, 1);
  assert.equal(m.setting('played'), 1);
});

test('입력 오류는 400', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  for (const bad of [{ phone: '02-123-4567' }, { email: 'nope' }, { consent: false }, { jobRole: '해커' }, { fullName: '' }]) {
    const r = await roulette(person(3, bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(m.winners().length, 0);
});

test('open=0 이면 409 closed', async () => {
  const s = BASE_SETTINGS(); s.open = 0;
  const m = createMock(s); use(m);
  const r = await roulette(person(4));
  assert.deepEqual([r.status, r.body.error], [409, 'closed']);
});

test('전량 소진이면 409 sold_out', async () => {
  const s = BASE_SETTINGS(); s.beer5 = 0; s.nachos = 0; s.quesa = 0; s.beer1 = 1; s.issued_beer1 = 1;
  const m = createMock(s); use(m);
  const r = await roulette(person(5));
  assert.deepEqual([r.status, r.body.error], [409, 'sold_out']);
});

test('설정 행이 빠지면 not_configured', async () => {
  const s = BASE_SETTINGS(); delete s.mailed_total;
  const m = createMock(s); use(m);
  const r = await roulette(person(6));
  assert.deepEqual([r.status, r.body.error], [500, 'not_configured']);
});

test('메일 실패: 쿠폰은 유지, mailed=false, 메일 집계 그대로', async () => {
  const m = createMock(BASE_SETTINGS(), { mailFails: true }); use(m);
  const r = await roulette(person(7));
  assert.equal(r.status, 200);
  assert.equal(r.body.mailed, false);
  assert.equal(m.winners()[0].CouponMailed, false);
  assert.equal(m.setting('mailed_total'), 0);
});

test('기록 실패: 확보한 재고를 되돌리고 503', async () => {
  const m = createMock(BASE_SETTINGS(), { createFails: true }); use(m);
  const r = await roulette(person(8));
  assert.equal(r.status, 503);
  for (const k of ['beer5', 'nachos', 'quesa', 'beer1']) assert.equal(m.setting('issued_' + k), 0);
});

test('동시 40명: 한정 수량을 절대 넘지 않음 (eTag 충돌 재시도)', async () => {
  const s = BASE_SETTINGS();
  Object.assign(s, { beer5: 2, nachos: 3, quesa: 1, beer1: 20, expected: 30 });
  const m = createMock(s, { jitter: 15 }); use(m);
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => roulette(person(100 + i))));
  const awarded = rs.filter((r) => r.body.status === 'awarded');
  const soldOut = rs.filter((r) => r.body.error === 'sold_out');
  const w = m.winners();
  const count = (k) => w.filter((x) => x.PrizeKey === k).length;
  assert.equal(awarded.length, 26, 'limits sum = 26');
  assert.equal(soldOut.length + rs.filter((r) => r.body.error === 'busy').length, 14);
  assert.equal(w.length, 26);
  for (const [k, lim] of Object.entries({ beer5: 2, nachos: 3, quesa: 1, beer1: 20 })) {
    assert.ok(count(k) <= lim, `${k} ${count(k)} <= ${lim}`);
    assert.equal(m.setting('issued_' + k), count(k));
  }
  assert.equal(m.setting('issued_total'), 26);
  assert.equal(m.setting('played'), 26);
  assert.equal(new Set(w.map((x) => x.Title)).size, 26, '쿠폰 코드 중복 없음');
  assert.ok(m.stats.conflicts > 0, '충돌 상황이 실제로 발생했는지');
});

test('스태프: PIN 틀리면 401, 5회면 잠김', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  for (let i = 0; i < 4; i++) assert.equal((await staff({ pin: '0000', action: 'status' }, '1.2.3.4')).status, 401);
  assert.equal((await staff({ pin: '0000', action: 'status' }, '1.2.3.4')).status, 401);
  assert.equal((await staff({ pin: '483920', action: 'status' }, '1.2.3.4')).status, 429, '맞는 PIN도 잠금 중엔 거절');
  assert.equal((await staff({ pin: '483920', action: 'status' }, '5.6.7.8')).status, 200, '다른 IP는 정상');
});

test('스태프: 조회 → 사용 처리 → 집계 반영, 두 번째 사용은 409', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const a = await roulette(person(9));
  const look = await staff({ pin: '483920', action: 'lookup', phone4: '1009' }, 'ip');
  assert.equal(look.body.coupons[0].code, a.body.code);
  const r1 = await staff({ pin: '483920', action: 'redeem', code: a.body.code.toLowerCase(), staff: '바A' }, 'ip');
  assert.equal(r1.status, 200);
  assert.equal(r1.body.coupon.redeemed, true);
  assert.equal(m.winners()[0].Redeemed, true);
  assert.equal(m.winners()[0].CouponCheckedBy, '바A');
  assert.equal(m.setting('redeemed_' + a.body.prizeKey), 1);
  assert.equal(m.setting('redeemed_total'), 1);
  const r2 = await staff({ pin: '483920', action: 'redeem', code: a.body.code }, 'ip');
  assert.deepEqual([r2.status, r2.body.error], [409, 'already_redeemed']);
  assert.equal(m.setting('redeemed_total'), 1);
  const dup = await roulette(person(9));
  assert.equal(dup.body.redeemed, true, '손님 화면에 사용 완료 도장');
});

test('스태프: 같은 쿠폰을 동시에 두 번 사용 처리해도 1번만 반영', async () => {
  const m = createMock(BASE_SETTINGS(), { jitter: 15 }); use(m);
  const a = await roulette(person(10));
  const rs = await Promise.all([1, 2, 3].map(() => staff({ pin: '483920', action: 'redeem', code: a.body.code }, 'ip')));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(m.setting('redeemed_total'), 1);
});

test('스태프: 추첨 종료/재개', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const r = await staff({ pin: '483920', action: 'setOpen', open: false }, 'ip');
  assert.equal(r.body.open, false);
  assert.equal((await roulette(person(11))).body.error, 'closed');
  await staff({ pin: '483920', action: 'setOpen', open: true }, 'ip');
  assert.equal((await roulette(person(11))).body.status, 'awarded');
});

test('추첨 규칙', () => {
  const S = (o) => Object.fromEntries(Object.entries({ ...BASE_SETTINGS(), ...o }).map(([k, v]) => [k, { value: v }]));
  assert.equal(pickPrize(S({}), () => 0), 'beer5');
  assert.equal(pickPrize(S({}), () => 10), 'nachos');
  assert.equal(pickPrize(S({}), () => 40), 'quesa');
  assert.equal(pickPrize(S({}), () => 60), 'beer1');
  assert.equal(pickPrize(S({ beer1: 5, issued_beer1: 5 }), () => 200), 'beer5', '맥주 1잔 소진 시 특별 경품');
  assert.equal(pickPrize(S({ beer5: 0, nachos: 0, quesa: 0, beer1: 0 }), () => 0), null);
});

test('메일 HTML은 입력값을 이스케이프', () => {
  const { html, subject } = buildCouponMail({ fullName: '<script>x</script>', nickname: 'a&b', company: '"c"', prizeName: '나초', emoji: '🌮', code: 'GS-ABCDE', wonAt: '2026-11-03T20:46:22Z' });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('2026-11-04 05:46:22'), 'KST 표시');
  assert.equal(subject, '[GSTAR × GitHub Copilot] 나초 당첨 쿠폰 GS-ABCDE');
});

test('고객 입력값이 모든 열에 그대로 저장됨', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const input = {
    fullName: "김 O'Brien 민준", nickname: '코파일럿❤️러버', company: '메가존클라우드 (MZC) & Co.',
    phone: '01073313707', email: '  Celia.Yang+gstar@MegaZone.com ', jobRole: '영업·마케팅',
    consent: true, score: 240, bugs: 20,
  };
  const r = await roulette(input);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(m.stats.rejected, [], 'SharePoint가 거절한 필드 없음');
  const w = m.winners()[0];
  assert.equal(w.FullName, "김 O'Brien 민준");
  assert.equal(w.Nickname, '코파일럿❤️러버');
  assert.equal(w.Company, '메가존클라우드 (MZC) & Co.');
  assert.equal(w.Phone, '010-7331-3707');
  assert.equal(w.Phone4, '3707');
  assert.equal(w.Email, 'Celia.Yang+gstar@MegaZone.com', '대소문자·+ 그대로, 앞뒤 공백만 제거');
  assert.equal(w.JobRole, '영업·마케팅');
  assert.equal(w.Consent, true);
  assert.equal(w.Score, 240);
  assert.equal(w.Bugs, 20);
  assert.equal(w.Title, r.body.code);
  assert.equal(w.PrizeKey, r.body.prizeKey);
  assert.equal(w.Redeemed, false);
  assert.equal(w.CouponMailed, true);
  assert.equal(w.WonAt, r.body.wonAt);
  const again = await roulette({ ...input, phone: '010-7331-3707' });
  assert.equal(again.body.status, 'duplicate', '하이픈 유무와 관계없이 같은 번호로 인식');
  assert.equal(again.body.code, r.body.code);
});

test('페이지 입력 한도(maxlength) 최대 길이도 저장됨', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const r = await roulette(person(12, { fullName: '가'.repeat(30), nickname: '나'.repeat(20), company: '다'.repeat(40), email: 'a'.repeat(88) + '@b.co.kr' }));
  assert.equal(r.status, 200);
  assert.deepEqual(m.stats.rejected, []);
  const w = m.winners()[0];
  assert.equal(w.FullName.length, 30); assert.equal(w.Nickname.length, 20); assert.equal(w.Company.length, 40);
  assert.equal(w.Email.length, 96);
});

test('API가 쓰는 모든 열 이름이 실제 목록에 있음 (사용 처리 포함)', async () => {
  const m = createMock(BASE_SETTINGS()); use(m);
  const a = await roulette(person(13));
  await staff({ pin: '483920', action: 'redeem', code: a.body.code, staff: '바B' }, 'ip');
  assert.deepEqual(m.stats.rejected, []);
  const w = m.winners()[0];
  assert.equal(w.Redeemed, true);
  assert.match(w.CouponCheckedAt, /^\d{4}-/);
  assert.equal(w.CouponCheckedBy, '바B');
});

test('메일에 두 장소 주소와 지도 링크 포함', () => {
  const { html } = buildCouponMail({ fullName: 'a', nickname: 'b', company: 'c', prizeName: '나초', emoji: '🌮', code: 'GS-ABCDE', wonAt: '2026-11-05T01:00:00Z' });
  assert.ok(html.includes('부산광역시 해운대구 해운대해변로298번길 24 1층 1-19호'));
  assert.ok(html.includes('부산 해운대구 센텀2로 25'));
  assert.equal((html.match(/map\.naver\.com\/p\/search\//g) || []).length, 2);
  assert.equal((html.match(/map\.kakao\.com\/link\/search\//g) || []).length, 2);
  assert.equal((html.match(/google\.com\/maps\/search\//g) || []).length, 2);
});

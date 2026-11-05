const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCouponEmail } = require('./coupon-email');
const store = require('./table-store');

test('renders the coupon email with escaped participant data and event links', () => {
  const email = renderCouponEmail({
    fullName: '<양선주>',
    nickname: '코파일럿 해커',
    company: '상상체크단',
    coupon: {
      code: 'GS-JV6WH',
      prizeKey: 'beer1',
      wonAt: '2026-11-03T09:57:07.000Z'
    }
  });

  assert.equal(email.subject, '[GSTAR × GitHub Copilot] 맥주 1잔 당첨 쿠폰 GS-JV6WH');
  assert.match(email.html, /&lt;양선주&gt;님, 맥주 1잔 당첨을 축하합니다!/);
  assert.match(email.html, /GS-JV6WH/);
  assert.match(email.html, /리리코이 · 올데이라운지/);
  assert.match(email.html, /https:\/\/github\.com\/github-copilot\/signup/);
  assert.match(email.html, /ref_product=copilot&amp;ref_type=trial/);
  assert.match(email.html, /https:\/\/www\.youtube\.com\/watch\?v=AArI948SDz8/);
  assert.doesNotMatch(email.html, /<양선주>/);
  assert.match(email.plainText, /쿠폰 코드: GS-JV6WH/);
});

test('rejects unknown prize types instead of sending a malformed coupon', () => {
  assert.throws(() => renderCouponEmail({
    fullName: '테스트',
    nickname: '테스터',
    company: '팀',
    coupon: { code: 'GS-ABC123', prizeKey: 'unknown', wonAt: '2026-11-03T09:57:07.000Z' }
  }), { message: 'invalid_coupon_prize' });
});

test('markMailed persists the successful delivery state with the winner ETag', async () => {
  const winner = {
    partitionKey: store.PARTITION,
    rowKey: `winner-${'a'.repeat(64)}`,
    kind: 'winner',
    couponCode: 'ABCDEFGH',
    prizeKey: 'beer1',
    wonAt: '2026-11-03T09:57:07.000Z',
    nickname: '테스터',
    company: '팀',
    redeemed: false,
    etag: '"winner-etag"'
  };
  let update;
  const client = {
    async *listEntities() {
      yield winner;
    },
    async updateEntity(entity, mode, options) {
      update = { entity, mode, options };
    }
  };

  await store.markMailed(client, 'ABCDEFGH');

  assert.equal(update.entity.mailed, true);
  assert.equal(update.entity.partitionKey, store.PARTITION);
  assert.equal(update.mode, 'Merge');
  assert.equal(update.options.etag, '"winner-etag"');
});

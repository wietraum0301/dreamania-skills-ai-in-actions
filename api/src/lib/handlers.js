'use strict';
/* HTTP와 무관한 업무 로직. functions/*.js 가 요청을 받아 여기로 넘깁니다. 반환: { status, body } */
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const { PRIZES, pickPrize, remaining, newCouponCode } = require('./draw');
const { sendCouponMail } = require('./mail');

const ROLES = ['개발', '기획', '디자인', '영업·마케팅', '경영·관리', '기타'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}
function phoneFmt(v) {
  const d = String(v || '').replace(/\D/g, '');
  return /^01\d{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : null;
}
function maskEmail(e) {
  const at = String(e || '').lastIndexOf('@');
  return at < 1 ? '' : e.slice(0, Math.min(2, at)) + '***' + e.slice(at);
}
function intIn(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : 0;
}

function storeFailure(e, log) {
  log && log(`저장소 오류: ${e.code || e.message}${e.status ? ' (HTTP ' + e.status + ')' : ''}${e.missing ? ' 누락 키: ' + e.missing.join(',') : ''}`);
  if (e.code === 'not_configured' || e.code === 'auth_failed') return { status: 500, body: { error: 'not_configured' } };
  return { status: 503, body: { error: 'store_unavailable' } };
}

function couponBody(status, f, extra = {}) {
  return {
    status,
    code: f.Title,
    prizeKey: f.PrizeKey,
    nickname: f.Nickname || '',
    company: f.Company || '',
    wonAt: f.WonAt || '',
    mailed: f.CouponMailed === true,
    redeemed: f.Redeemed === true,
    emailMasked: maskEmail(f.Email),
    ...extra,
  };
}

/* ---------------- 참가 · 쿠폰 생성 ---------------- */
async function roulette(input, log) {
  if (!cfg.isConfigured()) return { status: 500, body: { error: 'not_configured' } };
  const p = input || {};
  const fullName = text(p.fullName, 30);
  const nickname = text(p.nickname, 20);
  const company = text(p.company, 40);
  const phone = phoneFmt(p.phone);
  /* 입력한 그대로 저장 (앞뒤 공백만 제거). 대소문자 변경 없음 */
  const email = typeof p.email === 'string' ? p.email.trim() : '';
  const jobRole = ROLES.includes(p.jobRole) ? p.jobRole : null;
  if (!fullName || !nickname || !company || !phone || !jobRole || p.consent !== true ||
      email.length > 100 || !EMAIL_RE.test(email)) {
    return { status: 400, body: { error: 'invalid_input' } };
  }

  try {
    let settings = await store.getSettings();
    if (settings.open.value === 0) return { status: 409, body: { error: 'closed' } };

    /* 1인 1회: 같은 번호면 기존 쿠폰을 그대로 돌려줌 */
    const dup = await store.findByPhone(phone);
    if (dup.length) return { status: 200, body: couponBody('duplicate', dup[0].fields) };

    /* 추첨 + 재고 확보 (issued_* 카운터를 If-Match로 올려야 확정) */
    let prizeKey = null;
    for (let attempt = 0; attempt < 6 && !prizeKey; attempt++) {
      if (attempt) settings = await store.getSettings();
      const key = pickPrize(settings);
      if (!key) return { status: 409, body: { error: 'sold_out' } };
      const claim = await store.adjustCounter(settings, 'issued_' + key, 1, { max: settings[key].value });
      if (claim.ok) prizeKey = key;
    }
    if (!prizeKey) return { status: 503, body: { error: 'busy' } };

    const code = newCouponCode();
    const wonAt = new Date().toISOString();
    let item;
    try {
      item = await store.createWinner({
        Title: code, FullName: fullName, Nickname: nickname, Company: company,
        Phone: phone, Phone4: phone.slice(-4), Email: email, JobRole: jobRole,
        PrizeKey: prizeKey, PrizeName: PRIZES[prizeKey].name,
        Score: intIn(p.score, 0, 100000), Bugs: intIn(p.bugs, 0, 10000),
        Consent: true, Redeemed: false, CouponMailed: false, WonAt: wonAt,
      });
    } catch (e) {
      /* 기록을 못 남겼으면 확보한 재고를 되돌림 */
      await store.adjustCounter(settings, 'issued_' + prizeKey, -1).catch(() => {});
      throw e;
    }

    await Promise.all([
      store.adjustCounter(settings, 'played', 1),
      store.adjustCounter(settings, 'issued_total', 1),
    ]).catch((e) => log && log('집계 업데이트 실패: ' + e.message));

    const mailed = await sendCouponMail(email, {
      fullName, nickname, company, prizeName: PRIZES[prizeKey].name, emoji: PRIZES[prizeKey].emoji, code, wonAt,
    }, log);
    if (mailed) {
      await store.updateWinner(item.id, { CouponMailed: true })
        .then(() => store.adjustCounter(settings, 'mailed_total', 1))
        .catch((e) => log && log('메일 발송 기록 실패: ' + e.message));
    }

    return {
      status: 200,
      body: { status: 'awarded', code, prizeKey, nickname, company, wonAt, mailed, redeemed: false, emailMasked: maskEmail(email) },
    };
  } catch (e) {
    return storeFailure(e, log);
  }
}

/* ---------------- 스태프: PIN · 조회 · 사용 처리 ---------------- */
const failures = new Map(); /* ip -> { count, until } (인스턴스 메모리, 무차별 대입 완화용) */
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

function pinOk(given, expected) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return expected !== '' && crypto.timingSafeEqual(a, b);
}

function statusBody(s) {
  const rem = remaining(s);
  const prizes = {};
  for (const k of Object.keys(PRIZES)) {
    prizes[k] = { name: PRIZES[k].name, limit: s[k].value, issued: s['issued_' + k].value, redeemed: s['redeemed_' + k].value, remaining: rem[k] };
  }
  return {
    open: s.open.value !== 0, played: s.played.value, expected: s.expected.value,
    issued: s.issued_total.value, redeemed: s.redeemed_total.value, mailed: s.mailed_total.value, prizes,
  };
}

function staffCoupon(w) {
  const f = w.fields;
  return {
    code: f.Title, prizeKey: f.PrizeKey, prizeName: f.PrizeName, fullName: f.FullName || '', nickname: f.Nickname || '',
    company: f.Company || '', phone4: f.Phone4 || '', wonAt: f.WonAt || '', redeemed: f.Redeemed === true,
    checkedAt: f.CouponCheckedAt || '', checkedBy: f.CouponCheckedBy || '', mailed: f.CouponMailed === true,
  };
}

async function staff(input, ip, log) {
  if (!cfg.isConfigured()) return { status: 500, body: { error: 'not_configured' } };
  const p = input || {};
  const key = ip || 'unknown';
  const fail = failures.get(key);
  if (fail && fail.until > Date.now()) return { status: 429, body: { error: 'locked' } };

  try {
    const settings = await store.getSettings();
    if (!pinOk(p.pin, settings.pin.label)) {
      /* 잠금이 풀린 뒤(until 지남)에만 횟수를 새로 셈 */
      const expired = fail && fail.until > 0 && fail.until <= Date.now();
      const n = (fail && !expired ? fail.count : 0) + 1;
      failures.set(key, { count: n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      return { status: 401, body: { error: 'bad_pin', left: Math.max(0, MAX_FAILS - n) } };
    }
    failures.delete(key);

    switch (p.action) {
      case 'status':
        return { status: 200, body: statusBody(settings) };

      case 'setOpen': {
        await store.setSetting(settings, 'open', p.open ? 1 : 0);
        return { status: 200, body: statusBody(settings) };
      }

      case 'lookup': {
        const code = typeof p.code === 'string' ? p.code.trim().toUpperCase() : '';
        const phone4 = typeof p.phone4 === 'string' ? p.phone4.replace(/\D/g, '') : '';
        let rows;
        if (/^GS-[A-Z0-9]{5}$/.test(code)) rows = await store.findByCode(code);
        else if (/^\d{4}$/.test(phone4)) rows = await store.findByPhone4(phone4);
        else return { status: 400, body: { error: 'invalid_input' } };
        return { status: 200, body: { coupons: rows.map(staffCoupon) } };
      }

      case 'redeem': {
        const code = typeof p.code === 'string' ? p.code.trim().toUpperCase() : '';
        if (!/^GS-[A-Z0-9]{5}$/.test(code)) return { status: 400, body: { error: 'invalid_input' } };
        const by = (typeof p.staff === 'string' && p.staff.trim().slice(0, 30)) || '스태프';
        for (let attempt = 0; attempt < 4; attempt++) {
          const rows = await store.findByCode(code);
          if (!rows.length) return { status: 404, body: { error: 'not_found' } };
          const w = await store.readWinner(rows[0].id);
          if (w.fields.Redeemed === true) return { status: 409, body: { error: 'already_redeemed', coupon: staffCoupon(w) } };
          const now = new Date().toISOString();
          const r = await store.updateWinner(w.id, { Redeemed: true, CouponCheckedAt: now, CouponCheckedBy: by }, w.etag);
          if (r.ok) {
            const k = w.fields.PrizeKey;
            await Promise.all([
              store.PRIZE_KEYS.includes(k) ? store.adjustCounter(settings, 'redeemed_' + k, 1) : null,
              store.adjustCounter(settings, 'redeemed_total', 1),
            ]).catch((e) => log && log('사용 집계 실패: ' + e.message));
            return { status: 200, body: { coupon: staffCoupon({ fields: { ...w.fields, Redeemed: true, CouponCheckedAt: now, CouponCheckedBy: by } }) } };
          }
          if (r.status !== 412 && r.status !== 409) return storeFailure({ code: 'winner_write_failed', status: r.status }, log);
        }
        return { status: 503, body: { error: 'busy' } };
      }

      default:
        return { status: 400, body: { error: 'invalid_input' } };
    }
  } catch (e) {
    return storeFailure(e, log);
  }
}

module.exports = { roulette, staff, _test: { failures, maskEmail, phoneFmt } };

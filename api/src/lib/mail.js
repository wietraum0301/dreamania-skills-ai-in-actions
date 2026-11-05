'use strict';
/* 쿠폰 메일 (기존 "[샘플] 나초 당첨 쿠폰 GS-SAMPL" 메일 내용 기준) – Graph sendMail, 앱 권한 Mail.Send */
const cfg = require('./config');
const { graph } = require('./graph');

const LINKS = {
  pro: 'https://github.com/github-copilot/signup?ref_product=copilot&ref_type=trial&ref_style=button&ref_plan=pro',
  keynote: 'https://youtu.be/xbCa0aa4tRM',
  recap: 'https://youtube.com/shorts/A_N9HM237BA',
  studio: 'https://youtu.be/uUdntAejn2s',
};

/* 쿠폰 사용 장소 (지도 링크는 주소 검색 결과로 연결) */
const VENUES = [
  { name: '리리코이', address: '부산광역시 해운대구 해운대해변로298번길 24 1층 1-19호', mapQuery: '부산광역시 해운대구 해운대해변로298번길 24' },
  { name: '올데이라운지', address: '부산 해운대구 센텀2로 25', mapQuery: '부산 해운대구 센텀2로 25' },
];
function mapLinks(address) {
  const q = encodeURIComponent(address);
  return [
    ['네이버 지도', `https://map.naver.com/p/search/${q}`],
    ['카카오맵', `https://map.kakao.com/link/search/${q}`],
    ['Google Maps', `https://www.google.com/maps/search/?api=1&query=${q}`],
  ];
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function kst(iso) {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); /* 2026-11-03 05:46:22 */
}

function buildCouponMail({ fullName, nickname, company, prizeName, emoji, code, wonAt }) {
  const subject = `[GSTAR × GitHub Copilot] ${prizeName} 당첨 쿠폰 ${code}`;
  const FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Arial,sans-serif";
  /* 둥근 사각형(round square) 버튼 – 표(table) 기반이라 Outlook에서도 버튼 모양 유지 */
  const btnCell = (href, label, bg) =>
    `<td align="center" bgcolor="${bg}" style="border-radius:10px;background:${bg}">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td>`;
  const buttons = (cells) =>
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto"><tr>${cells}</tr></table>`;
  const linkCell = (href, label, color) =>
    `<td align="center" style="padding-left:16px"><a href="${esc(href)}" target="_blank" style="font-family:${FONT};font-size:15px;font-weight:700;color:${color};text-decoration:underline">${esc(label)}</a></td>`;
  const heading = (t) => `<div style="font-size:17px;line-height:26px;font-weight:800;color:#1f2328;margin:0 0 6px;text-align:center">${esc(t)}</div>`;
  const para = (t) => `<div style="font-size:15px;line-height:24px;color:#1f2328;margin:0;text-align:center">${t}</div>`;
  const section = (inner, top = 30) => `<tr><td align="center" style="padding:${top}px 0 0;text-align:center">${inner}</td></tr>`;
  /* 둥근 사각형 카드 */
  const card = (title, desc, actions) =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 14px;border-collapse:separate;border:1px solid #d8dee4;border-radius:16px;background:#ffffff">
<tr><td align="center" style="padding:22px 20px;text-align:center;border-radius:16px">
<div style="font-size:16px;line-height:24px;font-weight:800;color:#1f2328">${esc(title)}</div>
<div style="font-size:14px;line-height:21px;color:#57606a;margin:6px 0 16px">${esc(desc)}</div>
${actions}
</td></tr></table>`;
  const venueNames = VENUES.map((v) => esc(v.name)).join(' · ');
  const venues = VENUES.map((v) => `<div style="font-size:13px;line-height:20px;color:#57606a;margin-top:10px;text-align:center">
<b style="color:#1f2328">📍 ${esc(v.name)}</b><br>${esc(v.address)}<br>
${mapLinks(v.mapQuery || v.address).map(([l, h]) => `<a href="${esc(h)}" target="_blank" style="color:#0969da;text-decoration:underline;margin:0 6px">${esc(l)}</a>`).join('')}
</div>`).join('');

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT};color:#1f2328">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background:#ffffff">
<tr><td align="center" style="padding:28px 16px">
<!--[if mso]><table role="presentation" width="800" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" align="center" style="width:100%;max-width:800px;margin:0 auto;text-align:center">

<tr><td align="center" style="text-align:center">
<div style="font-size:14px;line-height:20px;color:#57606a">GSTAR 2026 × GitHub Copilot 팝업</div>
<div style="font-size:24px;line-height:34px;font-weight:800;color:#1f2328;margin-top:4px">${esc(fullName)}님, ${esc(prizeName)} 당첨을 축하합니다!</div>
</td></tr>

<!-- 쿠폰: 둥근 사각형 카드 -->
<tr><td align="center" style="padding:18px 0 0">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f3ff" style="border-collapse:separate;border:2px dashed #7c3aed;border-radius:18px;background:#f5f3ff">
<tr><td align="center" style="padding:30px 16px 22px;text-align:center;border-radius:18px">
  <div style="font-size:48px;line-height:54px">${esc(emoji)}</div>
  <div style="font-size:22px;line-height:30px;font-weight:800;color:#1f2328;margin-top:4px">${esc(prizeName)}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:14px auto 0">
    <tr><td align="center" bgcolor="#111827" style="padding:11px 20px;border-radius:10px;background:#111827;font-family:Menlo,Consolas,'Courier New',monospace;font-size:22px;line-height:26px;font-weight:800;letter-spacing:3px;color:#ffffff">${esc(code)}</td></tr>
  </table>
  <div style="font-size:13px;line-height:19px;color:#57606a;margin-top:14px">${esc(nickname)} · ${esc(company)} · ${esc(kst(wonAt))}</div>
</td></tr></table>
</td></tr>

${section(heading('수령 방법') + para(`이 메일의 쿠폰 코드를 <b>${venueNames}</b> 바 스태프에게 보여 주세요.<br>쿠폰은 1회만 사용할 수 있습니다.`) + venues, 26)}

${section(heading('GitHub Copilot 한 줄 소개') + para('Copilot Chat에 “이 코드 설명해줘”라고 물으면<br>레거시 코드도 바로 이해할 수 있어요.'))}

${section(heading('지금 바로 써 보세요') + '<div style="height:10px;line-height:10px">&nbsp;</div>' +
  card('GitHub Copilot Pro 체험하기', '에이전트 모드, 코드 리뷰, 최신 모델을 개인 계정에서 바로 써 볼 수 있습니다.',
    buttons(btnCell(LINKS.pro, 'Copilot Pro 시작하기', '#6d28d9'))) +
  card('GitHub Universe 2026 · Copilot 업데이트 공개', 'GitHub Copilot 앱, Copilot Fusion, Copilot Projects, Code Review Max 등 새 기능 발표 영상입니다.',
    buttons(btnCell(LINKS.keynote, '기조연설 보기 (YouTube)', '#b91c1c') + linkCell(LINKS.recap, '8분 요약 보기', '#b91c1c'))))}

<tr><td align="center" style="padding:24px 0 0;font-size:12px;line-height:18px;color:#8c959f;text-align:center">
본 메일은 GSTAR 2026 GitHub Copilot 팝업 이벤트 참여 시 입력하신 이메일로 발송되었습니다.
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject, html };
}

/* 성공하면 true. 실패해도 예외를 던지지 않음(쿠폰 지급은 유지) */
async function sendCouponMail(to, data, log) {
  if (!cfg.mailFrom) { log && log('MAIL_FROM 미설정: 메일 건너뜀'); return false; }
  const { subject, html } = buildCouponMail(data);
  try {
    const r = await graph('POST', `/users/${encodeURIComponent(cfg.mailFrom)}/sendMail`, {
      body: {
        message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
        saveToSentItems: false,
      },
    });
    if (r.status !== 202 && !r.ok) { log && log('sendMail 실패: HTTP ' + r.status); return false; }
    return true;
  } catch (e) {
    log && log('sendMail 오류: ' + e.message);
    return false;
  }
}

module.exports = { buildCouponMail, sendCouponMail, esc, VENUES, mapLinks };

const { EmailClient } = require('@azure/communication-email');

const SEND_TIMEOUT_MS = 5000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

const VENUE_BY_DAY = {
  19: { name: '올데이라운지', address: '부산 해운대구 센텀2로 25 106호' },
  20: { name: '리리코이', address: '부산 해운대구 해운대해변로 298번길 24 1층 1-19호' }
};
const ALL_VENUES = [VENUE_BY_DAY[19], VENUE_BY_DAY[20]];
const KEYNOTE_URL = 'https://www.youtube.com/watch?v=AArI948SDz8';
const SUMMARY_URL = 'https://www.youtube.com/watch?v=xbCa0aa4tRM';
const COPILOT_URL = 'https://github.com/features/copilot';

// Event days are judged in KST, the timezone the participants and staff use.
function kstParts(iso) {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
  const time = `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}`;
  return { day: kst.getUTCDate(), text: `${date} ${time}` };
}

function venuesFor(day) {
  return VENUE_BY_DAY[day] ? [VENUE_BY_DAY[day]] : ALL_VENUES;
}

function mapUrl(address) {
  return `https://map.naver.com/p/search/${encodeURIComponent(address)}`;
}

function buildMessage({ email, fullName, nickname, company, wonAt, prizeName, code }, sender) {
  const { day, text: wonText } = kstParts(wonAt);
  const venues = venuesFor(day);
  const subject = `[GSTAR × GitHub Copilot] ${prizeName} 당첨 쿠폰 ${code}`;
  const venueText = venues.map((venue) =>
    `${venue.name}: ${venue.address}\n지도: ${mapUrl(venue.address)}`).join('\n\n');
  const plainText = [
    'GSTAR 2026 × GitHub Copilot 팝업',
    `${fullName}님, ${prizeName} 당첨을 축하합니다!`,
    '',
    `쿠폰 코드: ${code}`,
    `${company} · ${nickname} · ${wonText}`,
    '',
    '[수령 방법]',
    '이 메일의 쿠폰 코드를 바 스태프에게 보여 주세요. 쿠폰은 1회만 사용할 수 있습니다.',
    '',
    '[수령 장소]',
    venueText,
    '',
    '[GitHub Copilot 한 줄 소개]',
    '게임 서버 코드의 테스트 케이스는 Copilot에게 맡기고 기획에 집중하세요.',
    '',
    `Copilot Pro 시작하기: ${COPILOT_URL}`,
    `기조연설 보기: ${KEYNOTE_URL}`,
    `8분 요약 보기: ${SUMMARY_URL}`,
    '',
    '본 메일은 GSTAR 2026 GitHub Copilot 팝업 이벤트 참여 시 입력한 이메일로 발송되었습니다.'
  ].join('\n');

  const card = (title, body) => `<div style="border:1px solid #d0d7de;border-radius:12px;padding:16px;margin:12px 0">
<p style="margin:0 0 6px;font-weight:700">${title}</p>${body}</div>`;
  const button = (href, label, color) => `<a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px">${label}</a>`;
  const venueHtml = venues.map((venue) => `<p style="margin:6px 0"><b>${escapeHtml(venue.name)}</b><br>${escapeHtml(venue.address)}<br>
<a href="${mapUrl(venue.address)}" style="color:#2f81f7">지도 보기</a></p>`).join('');

  const html = `<div style="max-width:640px;margin:0 auto;font-family:'Malgun Gothic',sans-serif;color:#1f2328">
<p style="color:#57606a;margin:0">GSTAR 2026 × GitHub Copilot 팝업</p>
<h2 style="margin:6px 0 16px">${escapeHtml(fullName)}님, ${escapeHtml(prizeName)} 당첨을 축하합니다!</h2>
<div style="border:2px dashed #a78bfa;border-radius:22px;padding:22px 18px;text-align:center;background:#f5f3ff">
<p style="font-size:14px;color:#57606a;margin:0 0 8px">${escapeHtml(prizeName)}</p>
<p style="display:inline-block;background:#0d1117;color:#fff;font:800 22px Consolas,monospace;letter-spacing:2px;border-radius:10px;padding:8px 14px;margin:8px 0">${escapeHtml(code)}</p>
<p style="font-size:13px;color:#57606a;margin:8px 0 0">${escapeHtml(company)} · ${escapeHtml(nickname)} · ${escapeHtml(wonText)}</p>
</div>
<h3 style="margin:20px 0 6px">수령 방법</h3>
<p style="margin:0">이 메일의 쿠폰 코드를 바 스태프에게 보여 주세요. 쿠폰은 1회만 사용할 수 있습니다.</p>
<h3 style="margin:20px 0 6px">수령 장소</h3>
${venueHtml}
<h3 style="margin:20px 0 6px">GitHub Copilot 한 줄 소개</h3>
<p style="margin:0">게임 서버 코드의 테스트 케이스는 Copilot에게 맡기고 기획에 집중하세요.</p>
<h3 style="margin:20px 0 6px">지금 바로 써 보세요</h3>
${card('GitHub Copilot Pro 체험하기', `<p style="margin:0 0 10px;color:#57606a">에이전트 모드, 코드 리뷰, 최신 모델을 개인 계정에서 바로 써 볼 수 있습니다.</p>${button(COPILOT_URL, 'Copilot Pro 시작하기', '#8250df')}`)}
${card('GitHub Universe 2026 · Copilot 업데이트 공개', `<p style="margin:0 0 10px;color:#57606a">GitHub Copilot 앱, Copilot Fusion, Copilot Projects, Code Review Max 등 새 기능 발표 영상입니다.</p>${button(KEYNOTE_URL, '기조연설 보기 (YouTube)', '#cf222e')} <a href="${SUMMARY_URL}" style="margin-left:8px;color:#cf222e;font-weight:700">8분 요약 보기</a>`)}
<p style="font-size:12px;color:#8c959f;margin-top:24px">본 메일은 GSTAR 2026 GitHub Copilot 팝업 이벤트 참여 시 입력한 이메일로 발송되었습니다.</p>
</div>`;

  return {
    senderAddress: sender,
    content: { subject, plainText, html },
    recipients: { to: [{ address: email }] }
  };
}

// Returns true only when Azure accepted the message. Never throws, so a mail failure
// does not undo an award that is already reserved in the table.
async function sendCouponMail(coupon) {
  const connection = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.ACS_SENDER_ADDRESS;
  if (!connection || !sender) {
    console.error('Coupon mail is not configured.');
    return false;
  }
  try {
    const client = new EmailClient(connection);
    await client.beginSend(buildMessage(coupon, sender), {
      abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    return true;
  } catch (error) {
    console.error(`Coupon mail failed (${error.name}).`);
    return false;
  }
}

module.exports = { sendCouponMail, buildMessage };

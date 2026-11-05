const { EmailClient } = require('@azure/communication-email');

const PRIZES = {
  beer5: { name: '맥주 5잔 세트', emoji: '🍻' },
  nachos: { name: '나초', emoji: '🌮' },
  quesa: { name: '퀘사디아', emoji: '🫓' },
  beer1: { name: '맥주 1잔', emoji: '🍺' }
};

const LINKS = {
  pro: 'https://github.com/github-copilot/signup?ref_product=copilot&ref_type=trial&ref_style=button&ref_plan=pro',
  keynote: 'https://www.youtube.com/watch?v=AArI948SDz8',
  recap: 'https://www.youtube.com/watch?v=xbCa0aa4tRM'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatWonAt(value) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(value));
}

function renderCouponEmail({ fullName, nickname, company, coupon }) {
  const prize = PRIZES[coupon.prizeKey];
  if (!prize) throw new Error('invalid_coupon_prize');

  const safeName = escapeHtml(fullName);
  const safePrize = escapeHtml(prize.name);
  const safeCode = escapeHtml(coupon.code);
  const safeNickname = escapeHtml(nickname);
  const safeCompany = escapeHtml(company);
  const wonAt = escapeHtml(formatWonAt(coupon.wonAt));
  const subject = `[GSTAR × GitHub Copilot] ${prize.name} 당첨 쿠폰 ${coupon.code}`;
  const html = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f4f6;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:460px;background:#fff">
      <tr><td style="padding:18px 20px 8px;text-align:center;color:#64748b;font-size:14px">GSTAR 2026 × GitHub Copilot 팝업</td></tr>
      <tr><td style="padding:0 20px 16px;text-align:center;font-size:20px;line-height:1.5;font-weight:800">${safeName}님, ${safePrize} 당첨을 축하합니다!</td></tr>
      <tr><td style="padding:0 20px 18px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:2px dashed #7c3aed;border-radius:16px;background:#f5f3ff;text-align:center">
          <tr><td style="padding:18px 12px 4px;font-size:36px">${prize.emoji}</td></tr>
          <tr><td style="padding:0 12px 10px;font-size:18px;font-weight:800">${safePrize}</td></tr>
          <tr><td style="padding:0 12px 8px"><span style="display:inline-block;border-radius:10px;background:#111827;padding:8px 14px;color:#fff;font-family:Consolas,monospace;font-size:22px;font-weight:800;letter-spacing:2px">${safeCode}</span></td></tr>
          <tr><td style="padding:0 12px 16px;color:#475569;font-size:12px">${safeNickname} · ${safeCompany} · ${wonAt}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 20px 18px">
        <p style="margin:0 0 4px;font-size:14px;font-weight:800">수령 방법</p>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6">이 메일의 쿠폰 코드를 <b>리리코이 · 올데이라운지</b> 바 스태프에게 보여 주세요. 쿠폰은 1회만 사용할 수 있습니다.</p>
      </td></tr>
      <tr><td style="padding:0 20px 18px">
        <p style="margin:0 0 4px;font-size:14px;font-weight:800">GitHub Copilot 한 줄 소개</p>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6">게임 서버 코드의 테스트 케이스는 Copilot에게 맡기고 기획에 집중하세요.</p>
      </td></tr>
      <tr><td style="padding:0 20px 8px;font-size:14px;font-weight:800">지금 바로 써 보세요</td></tr>
      <tr><td style="padding:0 20px 8px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #dbe3ee;border-radius:12px"><tr><td style="padding:12px">
          <p style="margin:0 0 4px;font-size:14px;font-weight:800">GitHub Copilot Pro 체험하기</p>
          <p style="margin:0 0 10px;color:#64748b;font-size:12px;line-height:1.5">에이전트 모드, 코드 리뷰, 최신 모델을 개인 계정에서 바로 써 볼 수 있습니다.</p>
          <a href="${escapeHtml(LINKS.pro)}" style="display:inline-block;border-radius:9px;background:#6d28d9;padding:10px 14px;color:#fff;text-decoration:none;font-size:13px;font-weight:800">Copilot Pro 시작하기</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 20px 18px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #dbe3ee;border-radius:12px"><tr><td style="padding:12px">
          <p style="margin:0 0 4px;font-size:14px;font-weight:800">GitHub Universe 2026 · Copilot 업데이트 공개</p>
          <p style="margin:0 0 10px;color:#64748b;font-size:12px;line-height:1.5">GitHub Copilot 앱, Copilot Fusion, Copilot Projects, Code Review Max 등 새 기능 발표 영상입니다.</p>
          <a href="${escapeHtml(LINKS.keynote)}" style="display:inline-block;border-radius:9px;background:#b91c1c;padding:10px 14px;color:#fff;text-decoration:none;font-size:13px;font-weight:800">기조연설 보기 (YouTube)</a>
          <a href="${escapeHtml(LINKS.recap)}" style="margin-left:10px;color:#b91c1c;font-size:13px;font-weight:700">8분 요약 보기</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:6px 20px 20px;color:#64748b;font-size:11px;line-height:1.5">본 메일은 GSTAR 2026 GitHub Copilot 팝업 이벤트 참여 시 입력하신 이메일로 발송되었습니다.</td></tr>
    </table>
  </td></tr></table>
</body>
</html>`;
  const plainText = [
    `GSTAR 2026 × GitHub Copilot 팝업`,
    `${fullName}님, ${prize.name} 당첨을 축하합니다!`,
    `${prize.emoji} ${prize.name}`,
    `쿠폰 코드: ${coupon.code}`,
    `${nickname} · ${company} · ${formatWonAt(coupon.wonAt)}`,
    '',
    '수령 방법',
    '이 메일의 쿠폰 코드를 리리코이 · 올데이라운지 바 스태프에게 보여 주세요. 쿠폰은 1회만 사용할 수 있습니다.',
    '',
    'GitHub Copilot 한 줄 소개',
    '게임 서버 코드의 테스트 케이스는 Copilot에게 맡기고 기획에 집중하세요.',
    '',
    `Copilot Pro 시작하기: ${LINKS.pro}`,
    `GitHub Universe 2026 기조연설: ${LINKS.keynote}`,
    `8분 요약 영상: ${LINKS.recap}`
  ].join('\n');

  return { subject, html, plainText };
}

async function sendCouponEmail({ recipient, fullName, nickname, company, coupon }) {
  const connectionString = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
  const senderAddress = process.env.AZURE_COMMUNICATION_EMAIL_SENDER;
  if (!connectionString || !senderAddress) throw new Error('email_not_configured');

  const content = renderCouponEmail({ fullName, nickname, company, coupon });
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    content,
    recipients: { to: [{ address: recipient, displayName: fullName }] }
  });
  const result = await poller.pollUntilDone();
  if (result.status !== 'Succeeded') {
    throw new Error(`email_send_failed:${result.status}`);
  }
}

module.exports = { renderCouponEmail, sendCouponEmail };

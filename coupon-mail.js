const { EmailClient } = require('@azure/communication-email');

const SEND_TIMEOUT_MS = 5000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function buildMessage({ email, nickname, prizeName, code }, sender) {
  const subject = '[GSTAR × GitHub Copilot] 쿠폰이 발급되었습니다';
  const plainText = [
    `${nickname}님, 축하합니다!`,
    '',
    `경품: ${prizeName}`,
    `쿠폰 번호: ${code}`,
    '',
    '리리코이 · 올데이라운지 바 스태프에게 이 쿠폰 번호를 보여 주세요.',
    '쿠폰은 1회만 사용할 수 있습니다.'
  ].join('\n');
  const html = `<p>${escapeHtml(nickname)}님, 축하합니다!</p>
<p>경품: <b>${escapeHtml(prizeName)}</b></p>
<p>쿠폰 번호: <b style="font-size:20px;letter-spacing:2px">${escapeHtml(code)}</b></p>
<p>리리코이 · 올데이라운지 바 스태프에게 이 쿠폰 번호를 보여 주세요.<br>쿠폰은 1회만 사용할 수 있습니다.</p>`;
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

const { createHmac } = require('node:crypto');

const prizeKeys = ['beer5', 'nachos', 'quesa', 'beer1'];

function reply(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

async function draw(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    reply(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    reply(response, 415, { error: 'invalid_content_type' });
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) {
      reply(response, 413, { error: 'payload_too_large' });
      return;
    }
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    reply(response, 400, { error: 'invalid_input' });
    return;
  }
  const text = (key, max) => typeof input?.[key] === 'string' &&
    input[key].trim().length > 0 && input[key].length <= max;
  const phone = typeof input?.phone === 'string' ? input.phone.replace(/-/g, '') : '';
  if (!text('fullName', 30) || !text('nickname', 20) || !text('company', 40) ||
    !text('email', 100) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    !/^01\d{9}$/.test(phone) ||
    !['개발', '기획', '디자인', '영업·마케팅', '경영·관리', '기타'].includes(input.jobRole) ||
    input.consent !== true || !Number.isInteger(input.score) || input.score < 0 ||
    input.score > 100000 || !Number.isInteger(input.bugs) || input.bugs < 0 || input.bugs > 10000) {
    reply(response, 400, { error: 'invalid_input' });
    return;
  }

  let url;
  try {
    url = new URL(process.env.ROULETTE_API_URL);
  } catch {
    console.error('Roulette backend URL is not configured correctly.');
    reply(response, 503, { error: 'not_configured' });
    return;
  }
  const secret = process.env.ROULETTE_IDENTITY_SECRET;
  if (url.protocol !== 'https:' || !secret || Buffer.byteLength(secret) < 32) {
    console.error('Roulette requires an HTTPS backend and an identity secret of at least 32 bytes.');
    reply(response, 503, { error: 'not_configured' });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        fullName: input.fullName.trim(),
        nickname: input.nickname.trim(),
        company: input.company.trim(),
        phone,
        phoneLast4: phone.slice(-4),
        email: input.email.trim(),
        jobRole: input.jobRole,
        consent: true,
        score: input.score,
        bugs: input.bugs,
        participantId: createHmac('sha256', secret).update(phone).digest('hex')
      })
    });
  } catch (error) {
    console.error(`Roulette backend request failed (${error.name}).`);
    reply(response, 502, { error: 'upstream_unavailable' });
    return;
  }

  let result;
  try {
    result = await upstream.json();
  } catch {
    console.error('Roulette backend returned invalid JSON.');
    reply(response, 502, { error: 'invalid_upstream_response' });
    return;
  }
  if (upstream.status === 409 && result?.error === 'sold_out') {
    reply(response, 409, { error: 'sold_out' });
    return;
  }
  if (!upstream.ok || !result || !['awarded', 'duplicate'].includes(result.status) ||
    !prizeKeys.includes(result.prizeKey) ||
    typeof result.code !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(result.code) ||
    typeof result.wonAt !== 'string' || !Number.isFinite(Date.parse(result.wonAt)) ||
    typeof result.nickname !== 'string' || !result.nickname || result.nickname.length > 20 ||
    typeof result.company !== 'string' || !result.company || result.company.length > 40) {
    console.error(`Roulette backend returned an invalid award response (HTTP ${upstream.status}).`);
    reply(response, 502, { error: 'invalid_upstream_response' });
    return;
  }
  reply(response, 200, {
    status: result.status,
    prizeKey: result.prizeKey,
    code: result.code,
    wonAt: result.wonAt,
    nickname: result.nickname,
    company: result.company,
    mailed: result.mailed === true
  });
}

module.exports = draw;

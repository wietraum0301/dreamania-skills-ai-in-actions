const store = require('./table-store');

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

  try {
    const result = await store.award(store.getClient(), {
      fullName: input.fullName.trim(), nickname: input.nickname.trim(),
      company: input.company.trim(), phone, email: input.email.trim(),
      jobRole: input.jobRole, consent: true, score: input.score, bugs: input.bugs
    }, store.getSecret());
    reply(response, 200, result);
  } catch (error) {
    const expected = error instanceof store.RouletteError;
    if (!expected || error.code !== 'sold_out') {
      console.error(`Roulette table operation failed (${expected ? error.code : error.name}).`);
    }
    reply(response, expected ? error.status : 503, {
      error: expected ? error.code : 'storage_failed'
    });
  }
}

module.exports = draw;

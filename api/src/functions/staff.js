'use strict';
const { app } = require('@azure/functions');
const { staff } = require('../lib/handlers');

app.http('staff', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'staff',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_input' } }; }
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim().replace(/:\d+$/, '');
    const r = await staff(body, ip, (m) => context.log(m));
    return { status: r.status, jsonBody: r.body, headers: { 'Cache-Control': 'no-store' } };
  },
});

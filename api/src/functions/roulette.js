'use strict';
const { app } = require('@azure/functions');
const { roulette } = require('../lib/handlers');

app.http('roulette', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'roulette',
  handler: async (request, context) => {
    let body;
    try { body = await request.json(); } catch { return { status: 400, jsonBody: { error: 'invalid_input' } }; }
    const r = await roulette(body, (m) => context.log(m));
    return { status: r.status, jsonBody: r.body, headers: { 'Cache-Control': 'no-store' } };
  },
});

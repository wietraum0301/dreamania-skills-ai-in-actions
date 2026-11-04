const { randomInt } = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SHORT_CODE = /^[A-Z0-9]{8}$/;
const LEGACY_CODE = /^GS-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function validCode(code) {
  return typeof code === 'string' && (SHORT_CODE.test(code) || LEGACY_CODE.test(code));
}

function normalizeCode(code) {
  if (typeof code !== 'string') return code;
  const value = code.trim();
  return /^gs-/i.test(value) ?
    value.toLowerCase().replace(/^gs-/, 'GS-') : value.toUpperCase();
}

function generateCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

module.exports = { validCode, normalizeCode, generateCode };

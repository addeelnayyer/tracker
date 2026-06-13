'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'nasr_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const secret = () => process.env.COOKIE_SECRET || 'nasr-dev-secret-change-in-production';

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', secret()).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verify(cookieStr) {
  if (typeof cookieStr !== 'string') return null;
  const dot = cookieStr.lastIndexOf('.');
  if (dot < 1) return null;
  const data = cookieStr.slice(0, dot);
  const sig = cookieStr.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret()).update(data).digest('hex');
  // SHA-256 hex is always 64 chars; reject anything that doesn't match that length
  if (sig.length !== 64 || expected.length !== 64) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, payload) {
  const cookie = sign({ ...payload, exp: Date.now() + SESSION_MS });
  res.cookie(COOKIE_NAME, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MS,
  });
}

function getSession(req) {
  return verify(req.cookies?.[COOKIE_NAME]);
}

module.exports = { sign, verify, setSessionCookie, getSession, COOKIE_NAME, SESSION_MS };

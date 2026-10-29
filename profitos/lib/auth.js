'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 14;
const COOKIE = 'profitos_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_DAYS * 86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return token;
}

function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function userFromRequest(db, req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(sha(token), Date.now()) || null;
}

function setCookie(res, token, secure) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}
function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// 简单的登录限流：同一 IP+邮箱 15 分钟内最多 10 次失败
const fails = new Map();
function tooManyFails(key) {
  const e = fails.get(key);
  return !!e && e.until > Date.now() && e.n >= 10;
}
function recordFail(key) {
  const e = fails.get(key);
  if (!e || e.until < Date.now()) fails.set(key, { n: 1, until: Date.now() + 15 * 60000 });
  else e.n++;
}
function clearFails(key) { fails.delete(key); }

module.exports = {
  hashPassword, verifyPassword, createSession, userFromRequest, setCookie, clearCookie, readCookie, sha, COOKIE,
  tooManyFails, recordFail, clearFails,
};

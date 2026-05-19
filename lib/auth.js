// lib/auth.js
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db     = require('./db');

const SECRET = () => process.env.JWT_SECRET;

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    SECRET(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function verify(token) { return jwt.verify(token, SECRET()); }

async function hash(plain)           { return bcrypt.hash(plain, 12); }
async function compare(plain, hashed){ return bcrypt.compare(plain, hashed); }

async function requireAuth(req, res) {
  const header = req.headers?.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return null;
  }
  try {
    const payload = verify(token);
    const user    = await db.getUserById(payload.id);
    if (!user || !user.is_active) {
      res.status(401).json({ ok: false, error: 'Account not found or inactive.' });
      return null;
    }
    return user;
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Session expired. Please sign in again.'
      : 'Invalid token.';
    res.status(401).json({ ok: false, error: msg });
    return null;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = { sign, verify, hash, compare, requireAuth, cors };

// api/health.js
const db = require('../lib/db');
const { cors } = require('../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, status: 'healthy', uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, status: 'unhealthy', error: 'Database unreachable' });
  }
};

// api/audit/index.js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  if (req.method === 'GET') {
    try {
      const limit = Math.min(parseInt(req.query?.limit) || 100, 500);
      const rows  = await db.getAuditLog(limit);
      return res.json({ ok: true, data: rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

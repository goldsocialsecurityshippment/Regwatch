// api/stats.js
const db = require('../lib/db');
const { requireAuth, cors } = require('../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const jurisdiction = req.query?.jurisdiction || null;
    const stats = await db.getStats(jurisdiction);
    res.json({ ok: true, data: stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

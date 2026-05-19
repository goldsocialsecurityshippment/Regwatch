// api/activity.js
const db = require('../lib/db');
const { requireAuth, cors } = require('../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const limit = Math.min(parseInt(req.query?.limit) || 20, 50);
    const rows  = await db.getActivity(limit);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

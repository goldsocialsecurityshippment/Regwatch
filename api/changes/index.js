// api/changes/index.js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  // GET /api/changes
  if (req.method === 'GET') {
    try {
      const limit      = parseInt(req.query?.limit) || 50;
      const jurisdiction = req.query?.jurisdiction || 'all';
      const changeType   = req.query?.type;
      const changes = await db.getChanges(limit, { jurisdiction, changeType });
      return res.json({ ok: true, data: changes });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // POST /api/changes/mark-all-read
  if (req.method === 'POST') {
    const path = req.url || '';
    if (path.includes('mark-all-read')) {
      try {
        await db.markAllChangesReviewed(user.id, req.body?.jurisdiction);
        return res.json({ ok: true });
      } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

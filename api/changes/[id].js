// api/changes/[id].js — review + version compare
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  const parts = (req.url || '').split('/').filter(Boolean);
  const id    = parseInt(parts[parts.indexOf('changes') + 1]);
  const action = parts[parts.indexOf('changes') + 2]; // 'review' or 'compare'

  if (!id) return res.status(400).json({ ok: false, error: 'Change ID required' });

  // POST /api/changes/:id/review
  if (req.method === 'POST' && action === 'review') {
    try {
      await db.markChangeReviewed(id, user.id);
      await db.logAudit({ userId: user.id, userEmail: user.email, action: 'change.reviewed', resource: 'change', resourceId: id });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // GET /api/changes/:id/compare
  if (req.method === 'GET' && action === 'compare') {
    try {
      const { rows } = await db.query('SELECT content_before, content_after, page_title FROM changes WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Change not found' });
      return res.json({ ok: true, data: { before: rows[0].content_before, after: rows[0].content_after, title: rows[0].page_title } });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

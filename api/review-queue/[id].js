// api/review-queue/[id].js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  const id = parseInt(req.url?.split('/').pop()) || parseInt(req.query?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'ID required' });

  if (req.method === 'PUT') {
    try {
      const { status, decision } = req.body || {};
      await db.updateReviewDecision(id, status || decision, user.id, decision || status);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

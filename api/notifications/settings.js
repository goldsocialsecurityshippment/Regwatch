// api/notifications/settings.js
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ ok: true, data: { email: true, slack: false, threshold: 'medium' } });
};

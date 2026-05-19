// api/auth/me.js
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ ok: true, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
};

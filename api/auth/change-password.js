// api/auth/change-password.js
const db = require('../../lib/db');
const { requireAuth, compare, hash, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const user = await requireAuth(req, res);
  if (!user) return;
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ ok: false, error: 'Both passwords required' });
    if (new_password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    const full = await db.getUserById(user.id);
    const valid = await compare(current_password, full.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Current password incorrect' });
    const newHash = await hash(new_password);
    await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, newHash]);
    await db.logAudit({ userId: user.id, userEmail: user.email, action: 'auth.password_changed', resource: 'user', resourceId: user.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

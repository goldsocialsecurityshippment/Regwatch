// api/users/index.js
const db = require('../../lib/db');
const { requireAuth, hash, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin only' });

  if (req.method === 'GET') {
    try {
      const rows = await db.getAllUsers();
      return res.json({ ok: true, data: rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  if (req.method === 'POST') {
    try {
      const { email, password, full_name, role } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });
      const ph = await hash(password);
      const created = await db.createUser({ email: email.toLowerCase(), password_hash: ph, full_name, role: role || 'analyst' });
      await db.logAudit({ userId: user.id, userEmail: user.email, action: 'user.created', resource: 'user', resourceId: created.id });
      return res.json({ ok: true, data: { id: created.id, email: created.email, full_name: created.full_name, role: created.role } });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Email already exists' });
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

// api/users/[id].js
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin only' });

  const id = parseInt(req.url?.split('/').pop()) || parseInt(req.query?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'ID required' });

  if (req.method === 'PUT') {
    try {
      const { role, is_active, full_name } = req.body || {};
      const updates = [], params = [id]; let p = 2;
      if (role)      { updates.push(`role=$${p++}`);      params.push(role); }
      if (full_name) { updates.push(`full_name=$${p++}`); params.push(full_name); }
      if (is_active !== undefined) { updates.push(`is_active=$${p++}`); params.push(is_active); }
      if (updates.length === 0) return res.status(400).json({ ok: false, error: 'Nothing to update' });
      await db.query(`UPDATE users SET ${updates.join(',')} WHERE id=$1`, params);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  res.status(405).json({ ok: false, error: 'Method not allowed' });
};

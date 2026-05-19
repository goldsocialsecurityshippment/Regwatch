// api/users/approve.js - Admin user approval
const db = require('../../lib/db');
const { requireAuth, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await requireAuth(req, res);
  if (!user) return;

  if (user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }

  if (req.method === 'GET') {
    // Get all pending users
    const result = await db.query(
      `SELECT id, email, full_name, firm_name, job_title, status, approval_requested_at, role
       FROM users WHERE status = 'pending' ORDER BY approval_requested_at DESC`
    );
    return res.json({ ok: true, data: result.rows });
  }

  if (req.method === 'POST') {
    const { user_id, action } = req.body || {};
    if (!user_id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'user_id and action (approve/reject) required' });
    }

    const newStatus = action === 'approve' ? 'active' : 'rejected';
    const approved = action === 'approve';

    await db.query(
      `UPDATE users SET status = $1, approved = $2, approved_at = NOW(), approved_by = $3
       WHERE id = $4`,
      [newStatus, approved, user.id, user_id]
    );

    const targetUser = await db.query('SELECT email, full_name FROM users WHERE id = $1', [user_id]);
    console.log(`[approve] ${action}: ${targetUser.rows[0]?.email} by ${user.email}`);

    return res.json({
      ok: true,
      message: `User ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
    });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};

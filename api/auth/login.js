// api/auth/login.js
const db = require('../../lib/db');
const { compare, sign, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });

    const user = await db.getUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    const valid = await compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    // Check approval status
    if (user.status === 'pending') {
      return res.status(403).json({ ok: false, error: 'Your account is pending admin approval. Please wait for approval before signing in.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ ok: false, error: 'Your account application was not approved. Please contact the administrator.' });
    }

    await db.updateUserLogin(user.id);
    await db.logAudit({
      userId: user.id, userEmail: user.email, action: 'auth.login',
      resource: 'user', resourceId: user.id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
    });

    const token = sign(user);
    res.json({
      ok: true, token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

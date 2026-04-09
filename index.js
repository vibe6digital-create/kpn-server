const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'kpn_jwt_secret_change_in_prod';
const JWT_EXPIRY = '30d';

app.use(cors({ origin: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Helpers ──
const signToken = (user) =>
  jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

const sanitiseUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  mobile: row.mobile,
  isSubscribed: !!row.is_subscribed,
});

// ── Auth middleware ──
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token required' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── POST /api/auth/check ── (check if user exists by email or mobile)
app.post('/api/auth/check', (req, res) => {
  const { email, mobile } = req.body;
  const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : '';
  let user = null;
  if (email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user && cleanMobile) user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(cleanMobile);
  if (user) {
    const token = signToken(user);
    return res.json({ exists: true, token, user: sanitiseUser(user) });
  }
  res.json({ exists: false });
});

// ── POST /api/auth/subscribe ── (no password needed)
app.post('/api/auth/subscribe', (req, res) => {
  const { name, email, mobile } = req.body;
  if (!name || (!email && !mobile))
    return res.status(400).json({ error: 'Name and email or mobile required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email' });
  if (mobile && !/^\d{10}$/.test(mobile.replace(/\D/g, '').slice(-10)))
    return res.status(400).json({ error: 'Invalid mobile number' });

  const cleanMobile = mobile ? mobile.replace(/\D/g, '').slice(-10) : '';

  // Check if already exists by email
  if (email) {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) {
      // Already subscribed — just log them in
      const token = signToken(existing);
      return res.json({ token, user: sanitiseUser(existing) });
    }
  }

  // Check if already exists by mobile
  if (cleanMobile) {
    const existing = db.prepare('SELECT * FROM users WHERE mobile = ?').get(cleanMobile);
    if (existing) {
      const token = signToken(existing);
      return res.json({ token, user: sanitiseUser(existing) });
    }
  }

  const info = db.prepare(
    'INSERT INTO users (name, email, mobile, password_hash) VALUES (?, ?, ?, ?)'
  ).run(name, email || null, cleanMobile || null, '');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: sanitiseUser(user) });
});

// ── GET /api/auth/me ──
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: sanitiseUser(user) });
});

// ── POST /api/auth/unsubscribe ── (deletes user from DB)
app.post('/api/auth/unsubscribe', auth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ success: true, message: 'Unsubscribed and removed successfully' });
});

// ── DELETE /api/admin/subscribers/:id ──
app.delete('/api/admin/subscribers/:id', (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Subscriber not found' });
  res.json({ success: true });
});

// ── GET /api/admin/subscribers ──
app.get('/api/admin/subscribers', (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, mobile, is_subscribed, created_at FROM users ORDER BY created_at DESC'
  ).all();
  const subscribers = users.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    isSubscribed: !!u.is_subscribed,
    subscribedAt: u.created_at,
  }));
  res.json({ subscribers });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

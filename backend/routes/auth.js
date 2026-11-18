const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

function publicUser(user) { return { id: user._id, name: user.name, studentId: user.studentId || '', email: user.email, role: user.role }; }
function tokenFor(user) { return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }); }
router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const studentId = String(req.body.studentId || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !studentId || !email || !password) return res.status(400).json({ message: 'Name, student ID, email and password are required.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const duplicate = await User.findOne({ $or: [{ email }, { studentId }] });
    if (duplicate) return res.status(409).json({ message: 'Email or student ID is already registered.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, studentId, email, passwordHash, role: 'student' });
    res.status(201).json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) { next(error); }
});
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
    res.json({ token: tokenFor(user), user: publicUser(user) });
  } catch (error) { next(error); }
});
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
module.exports = router;

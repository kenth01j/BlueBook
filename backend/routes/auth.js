const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Order = require('../models/Order');
const { getAvailableSchools, isAvailableSchool } = require('../services/schoolSettings');
const { requireAuth, requireRole } = require('../middleware/auth');

function publicUser(user) { return { id: user._id, name: user.name, studentId: user.studentId || '', school: user.school || '', email: user.email, role: user.role }; }
function tokenFor(user) { return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }); }
router.get('/schools', async (_req, res, next) => {
  try {
    res.json({ schools: await getAvailableSchools() });
  } catch (error) {
    next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const studentId = String(req.body.studentId || '').trim();
    const school = String(req.body.school || '').trim().toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !studentId || !school || !email || !password) return res.status(400).json({ message: 'Name, student ID, school, email and password are required.' });
    if (!isAvailableSchool(school, await getAvailableSchools())) {
      return res.status(400).json({ message: 'Choose a valid school.' });
    }
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const duplicate = await User.findOne({ $or: [{ email }, { studentId }] });
    if (duplicate) return res.status(409).json({ message: 'Email or student ID is already registered.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, studentId, school, email, passwordHash, role: 'student' });
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

router.patch('/me', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const studentId = String(req.body.studentId || '').trim();
    const school = String(req.body.school || '').trim().toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!name || name.length > 100 || !studentId || studentId.length > 50 || !school || !email) {
      return res.status(400).json({
        message: 'Enter your name, student ID, designated school, and email.'
      });
    }
    if (!isAvailableSchool(school, await getAvailableSchools())) {
      return res.status(400).json({ message: 'Choose a valid school.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (newPassword && newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must contain at least 8 characters.' });
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const duplicate = await User.findOne({
      _id: { $ne: user._id },
      $or: [{ email }, { studentId }]
    });
    if (duplicate) {
      return res.status(409).json({ message: 'Email or student ID is already registered.' });
    }

    if (school !== user.school) {
      await Order.updateMany(
        {
          user: user._id,
          $or: [
            { school: { $exists: false } },
            { school: null },
            { school: '' }
          ]
        },
        { $set: { school: user.school || 'Not specified' } }
      );
    }

    user.name = name;
    user.studentId = studentId;
    user.school = school;
    user.email = email;
    if (newPassword) user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.json({
      message: 'Profile updated successfully.',
      user: publicUser(user)
    });
  } catch (error) { next(error); }
});

router.delete('/me', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const unresolvedOrder = await Order.exists({
      user: user._id,
      status: { $in: ['RESERVED', 'PENDING_PAYMENT', 'PAID'] }
    });
    if (unresolvedOrder) {
      return res.status(409).json({
        message: 'Cancel, pay/claim, or wait for your active orders to finish before deactivating your account.'
      });
    }

    user.active = false;
    await user.save();
    res.json({
      message: 'Your account has been deactivated. Order and payment history is retained.'
    });
  } catch (error) { next(error); }
});

module.exports = router;

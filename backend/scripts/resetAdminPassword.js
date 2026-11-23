require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

function assertAtlasUri(uri) {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/:?]+)/i);
  if (!match || !/\.mongodb\.net$/i.test(match[1])) {
    throw new Error('MONGODB_URI must point to a MongoDB Atlas host.');
  }
}

async function resetAdminPassword() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to the existing administrator email in .env.');
  }
  if (password.length < 12 ||
      password === 'CHANGE_TO_A_UNIQUE_PASSWORD_AT_LEAST_12_CHARACTERS') {
    throw new Error('Set ADMIN_PASSWORD to a new, unique password of at least 12 characters in .env.');
  }

  assertAtlasUri(String(process.env.MONGODB_URI || ''));
  await connectDB();

  const admin = await User.findOne({ email }).select('+passwordHash');
  if (!admin || admin.role !== 'admin') {
    throw new Error('No administrator with ADMIN_EMAIL was found in Atlas.');
  }
  if (!admin.active) {
    throw new Error('The configured administrator account is inactive; password was not changed.');
  }

  admin.passwordHash = await bcrypt.hash(password, 12);
  await admin.save();
  console.log('Administrator password reset successfully.');
}

async function main() {
  try {
    await resetAdminPassword();
  } catch (error) {
    console.error('Admin password reset failed:', error.message);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error('MongoDB disconnect failed:', error.message);
      process.exitCode = 1;
    }
  }
}

main();

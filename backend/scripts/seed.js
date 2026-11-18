require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Product = require('../models/Product');

async function seedCashiers(adminEmail) {
  const cashiers = Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    return {
      number,
      email: String(process.env[`CASHIER_${number}_EMAIL`] || '').trim().toLowerCase(),
      password: String(process.env[`CASHIER_${number}_PASSWORD`] || '')
    };
  });
  const anyConfigured = cashiers.some(cashier => cashier.email || cashier.password);
  if (!anyConfigured) return;

  if (cashiers.some(cashier => !cashier.email || !cashier.password)) {
    throw new Error('Configure both email and password for all four cashier accounts in .env.');
  }
  if (cashiers.some(cashier =>
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cashier.email) ||
    cashier.password.length < 16
  )) {
    throw new Error('Cashier emails must be valid and each cashier password must contain at least 16 characters.');
  }

  const uniqueEmails = new Set(cashiers.map(cashier => cashier.email));
  const uniquePasswords = new Set(cashiers.map(cashier => cashier.password));
  if (uniqueEmails.size !== 4 || uniquePasswords.size !== 4) {
    throw new Error('Cashier emails and passwords must each be unique.');
  }
  if (uniqueEmails.has(adminEmail)) {
    throw new Error('A cashier email cannot also be the administrator email.');
  }

  const existingUsers = await User.find({ email: { $in: [...uniqueEmails] } })
    .select('email role active')
    .lean();
  const existingByEmail = new Map(existingUsers.map(user => [user.email, user]));
  for (const cashier of cashiers) {
    const existing = existingByEmail.get(cashier.email);
    if (existing && existing.role !== 'cashier') {
      throw new Error(`Cannot provision cashier ${cashier.number}: that email is already assigned to another role.`);
    }
    if (existing && !existing.active) {
      throw new Error(`Cannot provision cashier ${cashier.number}: the existing account is inactive.`);
    }
  }

  for (const cashier of cashiers) {
    const existing = await User.findOne({ email: cashier.email }).select('+passwordHash');
    const passwordHash = await bcrypt.hash(cashier.password, 12);
    if (!existing) {
      await User.create({
        name: `Cashier ${cashier.number}`,
        email: cashier.email,
        passwordHash,
        role: 'cashier'
      });
      console.log(`Cashier ${cashier.number} account created: ${cashier.email}`);
    } else {
      existing.name = `Cashier ${cashier.number}`;
      existing.passwordHash = passwordHash;
      await existing.save();
      console.log(`Cashier ${cashier.number} password updated from .env: ${cashier.email}`);
    }
  }
}

async function seed() {
  try {
    await connectDB();
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!email || password.length < 12 || password === 'CHANGE_TO_A_UNIQUE_PASSWORD_AT_LEAST_12_CHARACTERS') throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 12 characters in .env.');
    let admin = await User.findOne({ email });
    if (!admin) {
      admin = await User.create({ name: process.env.ADMIN_NAME || 'BiPSU Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
      console.log(`Administrator created: ${email}`);
    } else console.log(`Administrator already exists: ${email}`);
    await seedCashiers(email);
    await Product.updateOne({ sku: 'BB-001' }, { $setOnInsert: { sku: 'BB-001', name: 'Official Examination Bluebook', description: 'Standard university examination booklet', price: 15, onHand: 500, reserved: 0, active: true } }, { upsert: true });
    console.log('Bluebook product ready (SKU: BB-001).');
    console.log('Students should create their own accounts using the registration page.');
  } catch (error) { console.error('Seed failed:', error.message); process.exitCode = 1; }
  finally { await mongoose.disconnect().catch(() => {}); }
}
seed();

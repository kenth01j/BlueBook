const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const MongoRateLimitStore = require('./middleware/MongoRateLimitStore');
const proofStorage = require('./services/paymentProofStorage');

let storageConfiguration;

function configureApp(app) {
  const trustProxySetting = process.env.TRUST_PROXY || (process.env.VERCEL ? '1' : 'loopback');
  app.set(
    'trust proxy',
    /^\d+$/.test(trustProxySetting) ? Number(trustProxySetting) : trustProxySetting
  );

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/cron', require('./routes/cron'));
  app.use((req, res, next) => {
    ensureRuntimeReady()
      .then(() => next())
      .catch(next);
  });

  if (!process.env.VERCEL) {
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoRateLimitStore()
  }));
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok',
    app: 'BiPSU BlueBook',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    instance: getInstanceId()
  }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/payments', require('./routes/payments'));
  app.use('/api/cashier', require('./routes/cashier'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', (_req, res) => res.status(404).json({ message: 'API route not found.' }));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error.code === 11000) return res.status(409).json({ message: 'Email, student ID, or reference already exists.' });
    res.status(error.status || 500).json({ message: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : error.message });
  });

  return app;
}

function getInstanceId() {
  if (process.env.VERCEL) return 'vercel';
  const hostInstanceId = process.env.INSTANCE_ID || process.env.RENDER_INSTANCE_ID;
  const workerId = process.env.APP_WORKER_ID || 'single';
  return hostInstanceId ? `${hostInstanceId}/${workerId}` : workerId;
}

function ensureRuntimeReady() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return Promise.reject(new Error('JWT_SECRET must be set and contain at least 32 characters.'));
  }
  return Promise.all([connectDB(), ensureStorageConfiguration()]);
}

function ensureStorageConfiguration() {
  if (!storageConfiguration) {
    storageConfiguration = Promise.resolve().then(() => {
      proofStorage.validateConfiguration();
    }).catch(error => {
      storageConfiguration = undefined;
      throw error;
    });
  }
  return storageConfiguration;
}

module.exports = configureApp;

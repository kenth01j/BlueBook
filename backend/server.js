require('dotenv').config();
const app = require('../index');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const expirePendingOrders = require('./services/expireOrders');
const runWithDistributedJobLock = require('./services/distributedJobLock');
const proofStorage = require('./services/paymentProofStorage');
const PORT = process.env.PORT || 5000;
const workerId = process.env.APP_WORKER_ID || 'single';
let expirationInterval;
let httpServer;
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (expirationInterval) clearInterval(expirationInterval);

  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();
  if (!httpServer) {
    mongoose.disconnect().then(() => {
      proofStorage.close();
      process.exit(0);
    }).catch(error => {
      console.error('Database shutdown failed:', error.message);
      process.exit(1);
    });
    return;
  }

  httpServer.close(() => {
    mongoose.disconnect().then(() => {
      proofStorage.close();
      process.exit(0);
    }).catch(error => {
      console.error('Database shutdown failed:', error.message);
      process.exit(1);
    });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('disconnect', shutdown);

async function startServer() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set and contain at least 32 characters.');
  }
  proofStorage.validateConfiguration();
  await connectDB();
  if (process.env.RUN_ORDER_EXPIRATION !== 'false' && process.env.LOGIN_TEST_ONLY !== 'true') {
    const expireWithLock = () => runWithDistributedJobLock('expire-pending-orders', expirePendingOrders);
    await expireWithLock().catch(error => console.error('Initial expiry check failed:', error.message));
    expirationInterval = setInterval(
      () => expireWithLock().catch(error => console.error('Expiry check failed:', error.message)),
      60 * 1000
    );
  }
  httpServer = app.listen(PORT, () => console.log(`BiPSU BlueBook ${workerId} running at http://localhost:${PORT}`));
  return httpServer;
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };

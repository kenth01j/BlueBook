const router = require('express').Router();
const connectDB = require('../config/db');
const expirePendingOrders = require('../services/expireOrders');
const runWithDistributedJobLock = require('../services/distributedJobLock');
const isAuthorizedCronRequest = require('../utils/cronAuth');

router.get('/expire-orders', async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({ message: 'Scheduled order expiration is not configured.' });
  }
  if (!isAuthorizedCronRequest(req.get('authorization'), secret)) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    await connectDB();
    const ran = await runWithDistributedJobLock('expire-pending-orders', expirePendingOrders);
    return res.json({ status: ran ? 'completed' : 'already-running' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

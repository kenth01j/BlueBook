const express = require('express');
const mongoose = require('mongoose');
const NotificationDismissal = require('../models/NotificationDismissal');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Receipt = require('../models/Receipt');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('student'));

router.get('/dismissed', async (req, res, next) => {
  try {
    const dismissals = await NotificationDismissal.find({ user: req.user._id })
      .select('order')
      .lean();
    res.json({ orderIds: dismissals.map(item => item.order.toString()) });
  } catch (error) {
    next(error);
  }
});

router.post('/:orderId/dismiss', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orderId)) {
      return res.status(400).json({ message: 'Invalid notification order.' });
    }

    const order = await Order.findOne({
      _id: req.params.orderId,
      user: req.user._id,
      status: { $in: ['PAID', 'CLAIMED'] }
    }).select('_id');

    if (!order) {
      return res.status(404).json({ message: 'Verified payment notification not found.' });
    }

    const [verifiedPayment, issuedReceipt] = await Promise.all([
      Payment.exists({ order: order._id, status: 'VERIFIED' }),
      Receipt.exists({ order: order._id, status: { $in: ['ISSUED', 'CLAIMED'] } })
    ]);

    if (!verifiedPayment || !issuedReceipt) {
      return res.status(409).json({ message: 'Only verified payment notifications can be dismissed.' });
    }

    await NotificationDismissal.updateOne(
      { user: req.user._id, order: order._id },
      { $setOnInsert: { user: req.user._id, order: order._id } },
      { upsert: true }
    );

    res.json({ dismissed: true, orderId: order._id });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

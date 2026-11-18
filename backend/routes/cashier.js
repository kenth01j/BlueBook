const router = require('express').Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Receipt = require('../models/Receipt');
const claimPaidOrder = require('../services/claimPaidOrder');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.post('/scan-claim', requireRole('cashier'), async (req, res, next) => {
  try {
    const qrContent = String(req.body.qrContent || '').trim();
    const receiptPrefix = 'BIPSU-BLUEBOOK:RECEIPT:';
    const hasReceiptPrefix = qrContent.startsWith(receiptPrefix);
    const receiptNumber = hasReceiptPrefix
      ? qrContent.slice(receiptPrefix.length)
      : qrContent;

    if (
      qrContent.length > 128 ||
      !/^BB-[A-Z0-9-]{4,40}$/.test(receiptNumber) ||
      (qrContent.includes(':') && !hasReceiptPrefix)
    ) {
      return res.status(400).json({ message: 'This is not a valid Bluebook receipt QR code.' });
    }

    let receipt = await Receipt.findOne({ receiptNumber })
      .select('order status receiptNumber')
      .lean();

    let orderId = receipt?.order;
    if (!receipt && !hasReceiptPrefix) {
      const legacyOrder = await Order.findOne({ reference: qrContent }).select('_id').lean();
      orderId = legacyOrder?._id;
      if (orderId) {
        receipt = await Receipt.findOne({ order: orderId, status: 'ISSUED' })
          .select('order status receiptNumber')
          .lean();
      }
    }

    if (!orderId) {
      return res.status(404).json({ message: 'No matching Bluebook receipt was found.' });
    }

    if (!receipt) {
      return res.status(409).json({ message: 'No active claim receipt is available for this order.' });
    }

    if (receipt.status !== 'ISSUED') {
      return res.status(409).json({
        message: receipt.status === 'CLAIMED'
          ? 'This receipt has already been claimed.'
          : 'This receipt is void and cannot be used.'
      });
    }

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: 'The receipt does not contain a valid order reference.' });
    }

    const claimedOrder = await claimPaidOrder(orderId, req.user, {
      requireIssuedReceipt: true,
      receiptNumber: receipt.receiptNumber
    });
    const [claimedReceipt, orderDetails] = await Promise.all([
      Receipt.findOne({ order: claimedOrder._id, status: 'CLAIMED' })
        .select('receiptNumber status')
        .lean(),
      Order.findById(claimedOrder._id)
        .populate('user', 'name studentId')
        .lean()
    ]);

    res.json({
      message: 'Receipt verified and the order was marked claimed.',
      receipt: claimedReceipt,
      order: {
        id: orderDetails._id,
        reference: orderDetails.reference,
        studentName: orderDetails.user?.name || 'Student unavailable',
        studentId: orderDetails.user?.studentId || '',
        productName: orderDetails.productName,
        quantity: orderDetails.quantity,
        total: orderDetails.total,
        status: orderDetails.status,
        claimedAt: orderDetails.claimedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', requireRole('cashier'), async (req, res, next) => {
  try {
    const cashierId = req.user._id;
    const [salesRows, payments, claims] = await Promise.all([
      Order.aggregate([
        { $match: { claimedBy: cashierId, status: 'CLAIMED' } },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            quantity: { $sum: '$quantity' },
            orders: { $sum: 1 }
          }
        }
      ]),
      Payment.find({
        verifiedBy: cashierId,
        verifiedAt: { $ne: null }
      })
        .select('order student method amount status verifiedAt')
        .populate('order', 'reference quantity')
        .populate('student', 'name studentId')
        .sort({ verifiedAt: -1 })
        .limit(100)
        .lean(),
      Order.find({
        claimedBy: cashierId,
        status: 'CLAIMED'
      })
        .select('reference user quantity total paymentMethod status claimedAt')
        .populate('user', 'name studentId')
        .sort({ claimedAt: -1 })
        .limit(100)
        .lean()
    ]);

    const paymentHistory = payments.map(payment => ({
      id: `payment-${payment._id}`,
      action: payment.status === 'REJECTED'
        ? 'Payment proof rejected'
        : payment.method === 'CASH'
          ? 'Counter payment recorded'
          : 'Online payment verified',
      reference: payment.order?.reference || 'Order unavailable',
      studentName: payment.student?.name || 'Student unavailable',
      quantity: payment.order?.quantity ?? null,
      amount: payment.amount,
      paymentMethod: payment.method,
      status: payment.status,
      occurredAt: payment.verifiedAt
    }));
    const claimHistory = claims.map(order => ({
      id: `claim-${order._id}`,
      action: 'Bluebook handover confirmed',
      reference: order.reference,
      studentName: order.user?.name || 'Student unavailable',
      quantity: order.quantity,
      amount: order.total,
      paymentMethod: order.paymentMethod || 'CASH',
      status: order.status,
      occurredAt: order.claimedAt
    }));
    const history = [...paymentHistory, ...claimHistory]
      .sort((left, right) => new Date(right.occurredAt) - new Date(left.occurredAt))
      .slice(0, 100);
    const sales = salesRows[0] || { revenue: 0, quantity: 0, orders: 0 };

    res.json({
      dashboard: {
        sales: {
          revenue: sales.revenue,
          quantity: sales.quantity,
          orders: sales.orders
        },
        history
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

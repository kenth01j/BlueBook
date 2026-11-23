const router = require('express').Router();
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const scanClaimReceipt = require('../services/scanClaimReceipt');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.post('/scan-claim', requireRole('cashier'), async (req, res, next) => {
  try {
    res.json(await scanClaimReceipt(req.body.qrContent, req.user));
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ message: error.message });
    }
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

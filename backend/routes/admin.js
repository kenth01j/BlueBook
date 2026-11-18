
const router = require('express').Router();

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payment = require('../models/Payment');

const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/students', requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 100);
    if (query.length < 2) return res.json({ students: [] });

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(escaped, 'i');
    const students = await User.find({
      role: 'student',
      $or: [{ name: matcher }, { studentId: matcher }]
    })
      .select('name studentId email active createdAt')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    const ids = students.map(student => student._id);
    const counts = ids.length
      ? await Order.aggregate([
        { $match: { user: { $in: ids } } },
        { $group: { _id: '$user', totalOrders: { $sum: 1 } } }
      ])
      : [];
    const ordersByStudent = new Map(counts.map(row => [row._id.toString(), row.totalOrders]));

    res.json({
      students: students.map(student => ({
        id: student._id,
        name: student.name,
        studentId: student.studentId || '',
        email: student.email,
        active: student.active,
        createdAt: student.createdAt,
        totalOrders: ordersByStudent.get(student._id.toString()) || 0
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.use(requireRole('admin'));

async function salesSince(start, end) {
  const [sales] = await Order.aggregate([
    {
      $match: {
        status: 'CLAIMED',
        claimedAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$total' },
        quantity: { $sum: '$quantity' },
        orders: { $sum: 1 }
      }
    }
  ]);
  return {
    revenue: sales?.revenue || 0,
    quantity: sales?.quantity || 0,
    orders: sales?.orders || 0
  };
}

function philippineSalesPeriods(now) {
  const offsetMs = 8 * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + offsetMs);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();
  const daysSinceMonday = (localNow.getUTCDay() + 6) % 7;

  return {
    weekStart: new Date(Date.UTC(year, month, day - daysSinceMonday) - offsetMs),
    monthStart: new Date(Date.UTC(year, month, 1) - offsetMs)
  };
}

function reportPeriodRange(period, now) {
  const offsetMs = 8 * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + offsetMs);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();
  const daysSinceMonday = (localNow.getUTCDay() + 6) % 7;
  let start;

  if (period === 'daily') {
    start = Date.UTC(year, month, day);
  } else if (period === 'weekly') {
    start = Date.UTC(year, month, day - daysSinceMonday);
  } else if (period === 'monthly') {
    start = Date.UTC(year, month, 1);
  } else if (period === 'quarterly') {
    start = Date.UTC(year, Math.floor(month / 3) * 3, 1);
  } else {
    start = Date.UTC(year, 0, 1);
  }

  const labels = {
    daily: 'Today',
    weekly: 'This week',
    monthly: 'This month',
    quarterly: 'This quarter',
    annually: 'This year'
  };

  return {
    start: new Date(start - offsetMs),
    end: now,
    label: labels[period]
  };
}

function verificationLabel(user) {
  if (user?.role === 'cashier') return user.name || 'Cashier';
  if (user?.role === 'admin') return 'Admin';
  return '—';
}

function reportOrder(order, verifiedBy) {
  return {
    verifiedBy: verifiedBy || '—',
    handoverBy: order.claimedBy?.name || '',
    handoverRole: order.claimedBy?.role || '',
    cancelledBy: order.cancelledBy?.name || '',
    reference: order.reference,
    studentName: order.user?.name || '',
    studentId: order.user?.studentId || '',
    type: order.type,
    quantity: order.quantity,
    total: order.total,
    paymentMethod: order.paymentMethod || (order.type === 'PURCHASE' ? 'GCASH' : 'CASH'),
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    claimedAt: order.claimedAt || null,
    cancelledAt: order.cancelledAt || null,
    cancellationReason: order.cancellationReason || '',
    manualRefundRequired: Boolean(order.manualRefundRequired)
  };
}

router.get('/dashboard', async (_req, res, next) => {
  try {
    const now = new Date();
    const { weekStart, monthStart } = philippineSalesPeriods(now);

    const [
      totalStudents,
      totalBluebooksSold,
      totalReservations,
      revenueResult,
      pendingPayments,
      stockResult,
      weeklySales,
      monthlySales
    ] = await Promise.all([
      // Total registered student accounts
      User.countDocuments({ role: 'student' }),

      // Bluebooks physically released to students
      Order.aggregate([
        { $match: { status: 'CLAIMED' } },
        { $group: { _id: null, total: { $sum: '$quantity' } } }
      ]),

      // Reservations excluding expired and cancelled orders
      Order.countDocuments({
        type: 'RESERVATION',
        status: { $nin: ['EXPIRED', 'CANCELLED'] }
      }),

      // Sales count only after payment verification and physical claiming.
      Order.aggregate([
        { $match: { status: 'CLAIMED' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),

      // Orders awaiting payment
      Order.countDocuments({
        status: { $in: ['RESERVED', 'PENDING_PAYMENT'] }
      }),

      // Available inventory across active products
      Product.aggregate([
        { $match: { active: true } },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $max: [
                  0,
                  { $subtract: ['$onHand', '$reserved'] }
                ]
              }
            }
          }
        }
      ]),
      salesSince(weekStart, now),
      salesSince(monthStart, now)
    ]);

    res.json({
      dashboard: {
        totalStudents,
        totalBluebooksSold: totalBluebooksSold[0]?.total || 0,
        totalReservations,
        totalRevenue: revenueResult[0]?.total || 0,
        pendingPayments,
        availableStock: stockResult[0]?.total || 0,
        weeklySales,
        monthlySales
      }
    });

  } catch (error) {
    next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  const period = String(req.query.period || 'daily');
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'annually'].includes(period)) {
    return res.status(400).json({
      message: 'Period must be daily, weekly, monthly, quarterly, or annually.'
    });
  }

  try {
    const now = new Date();
    const range = reportPeriodRange(period, now);
    const claimedAt = { $gte: range.start, $lte: range.end };
    const createdAt = { $gte: range.start, $lte: range.end };
    const cancelledAt = { $gte: range.start, $lte: range.end };
    const [
      salesRows,
      cashierSalesRows,
      orderStatusRows,
      claimRows,
      cancellationRows,
      salesRecords,
      orderRecords,
      claimRecords,
      cancellationRecords
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: 'CLAIMED', claimedAt } },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            quantity: { $sum: '$quantity' },
            orders: { $sum: 1 }
          }
        }
      ]),
      Order.aggregate([
        { $match: { status: 'CLAIMED', claimedAt } },
        {
          $group: {
            _id: '$claimedBy',
            revenue: { $sum: '$total' },
            quantity: { $sum: '$quantity' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { revenue: -1, _id: 1 } }
      ]),
      Order.aggregate([
        { $match: { createdAt } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            quantity: { $sum: '$quantity' },
            amount: { $sum: '$total' }
          }
        }
      ]),
      Order.aggregate([
        { $match: { status: 'CLAIMED', claimedAt } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            quantity: { $sum: '$quantity' },
            amount: { $sum: '$total' }
          }
        }
      ]),
      Order.aggregate([
        { $match: { status: 'CANCELLED', cancelledAt } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            quantity: { $sum: '$quantity' },
            amount: { $sum: '$total' },
            manualRefunds: {
              $sum: { $cond: ['$manualRefundRequired', 1, 0] }
            }
          }
        }
      ]),
      Order.find({ status: 'CLAIMED', claimedAt })
        .sort({ claimedAt: -1 })
        .limit(100)
        .populate('user', 'name studentId')
        .populate('claimedBy', 'name role')
        .lean(),
      Order.find({ createdAt })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('user', 'name studentId')
        .populate('cancelledBy', 'name role')
        .lean(),
      Order.find({ status: 'CLAIMED', claimedAt })
        .sort({ claimedAt: -1 })
        .limit(100)
        .populate('user', 'name studentId')
        .populate('claimedBy', 'name role')
        .lean(),
      Order.find({ status: 'CANCELLED', cancelledAt })
        .sort({ cancelledAt: -1 })
        .limit(100)
        .populate('user', 'name studentId')
        .populate('cancelledBy', 'name role')
        .lean()
    ]);

    const reportOrders = [...salesRecords, ...orderRecords, ...claimRecords, ...cancellationRecords];
    const uniqueOrders = new Map(reportOrders.map(order => [order._id.toString(), order._id]));
    const verifiedPayments = uniqueOrders.size
      ? await Payment.find({
        order: { $in: [...uniqueOrders.values()] },
        status: 'VERIFIED'
      })
        .select('order verifiedBy verifiedAt')
        .populate('verifiedBy', 'name role')
        .sort({ verifiedAt: -1 })
        .lean()
      : [];
    const verifierByOrder = new Map();
    for (const payment of verifiedPayments) {
      const key = payment.order.toString();
      if (!verifierByOrder.has(key)) {
        verifierByOrder.set(key, verificationLabel(payment.verifiedBy));
      }
    }
    const toReportOrder = order => reportOrder(
      order,
      verifierByOrder.get(order._id.toString())
    );

    const cashiers = await User.find({ role: 'cashier' })
      .select('name')
      .sort({ name: 1 })
      .lean();
    const salesByCashierId = new Map(
      cashierSalesRows
        .filter(row => row._id)
        .map(row => [row._id.toString(), row])
    );
    const cashierSales = cashiers.map(cashier => {
      const sales = salesByCashierId.get(cashier._id.toString());
      return {
        cashierName: cashier.name,
        revenue: sales?.revenue || 0,
        quantity: sales?.quantity || 0
      };
    });

    const statusCounts = new Map(orderStatusRows.map(row => [row._id, row.count]));
    const orderTotal = orderStatusRows.reduce((sum, row) => sum + row.count, 0);
    const sales = salesRows[0] || { revenue: 0, quantity: 0, orders: 0 };
    const claims = claimRows[0] || { count: 0, quantity: 0, amount: 0 };
    const cancellations = cancellationRows[0] || {
      count: 0,
      quantity: 0,
      amount: 0,
      manualRefunds: 0
    };

    res.json({
      report: {
        period,
        range,
        sales: {
          revenue: sales.revenue,
          quantity: sales.quantity,
          orders: sales.orders,
          records: salesRecords.map(toReportOrder)
        },
        cashierSales,
        orders: {
          total: orderTotal,
          pending: (statusCounts.get('RESERVED') || 0) + (statusCounts.get('PENDING_PAYMENT') || 0),
          paid: (statusCounts.get('PAID') || 0) + (statusCounts.get('CLAIMED') || 0),
          expired: statusCounts.get('EXPIRED') || 0,
          cancelled: statusCounts.get('CANCELLED') || 0,
          records: orderRecords.map(toReportOrder)
        },
        claims: {
          count: claims.count,
          quantity: claims.quantity,
          amount: claims.amount,
          records: claimRecords.map(toReportOrder)
        },
        cancellations: {
          count: cancellations.count,
          quantity: cancellations.quantity,
          amount: cancellations.amount,
          manualRefunds: cancellations.manualRefunds,
          records: cancellationRecords.map(toReportOrder)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

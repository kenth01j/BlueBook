
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Receipt = require('../models/Receipt');
const Payment = require('../models/Payment');
const claimPaidOrder = require('../services/claimPaidOrder');
const scanClaimReceipt = require('../services/scanClaimReceipt');
const assertVerifiedReceipt = require('../services/assertVerifiedReceipt');
const { getOrderSettings, isValidOrderQuantity } = require('../services/orderSettings');

const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/limits', requireRole('student'), async (_req, res, next) => {
  try {
    const { maxOrderQuantity } = await getOrderSettings();
    res.json({ maxOrderQuantity });
  } catch (error) {
    next(error);
  }
});

function verificationLabel(user) {
  if (user?.role === 'cashier') return user.name || 'Cashier';
  if (user?.role === 'admin') return 'Admin';
  return '—';
}

async function orderSummaries(orders, includeVerifier = false) {
  const ids = orders.map(order => order._id);
  let payments = [];
  if (ids.length) {
    let paymentQuery = Payment.find({ order: { $in: ids } })
      .select('order status referenceNumber proofOriginalName remarks verifiedBy');
    if (includeVerifier) paymentQuery = paymentQuery.populate('verifiedBy', 'name role');
    payments = await paymentQuery.sort({ createdAt: -1 }).lean();
  }
  const receipts = ids.length
    ? await Receipt.find({
      order: { $in: ids },
      status: { $in: ['ISSUED', 'CLAIMED'] }
    })
      .select('order receiptNumber status issuedAt')
      .sort({ issuedAt: -1 })
      .lean()
    : [];
  const latestPayment = new Map();
  const latestReceipt = new Map();

  for (const payment of payments) {
    const key = payment.order.toString();
    if (!latestPayment.has(key)) latestPayment.set(key, payment);
  }

  for (const receipt of receipts) {
    const key = receipt.order.toString();
    if (!latestReceipt.has(key)) latestReceipt.set(key, receipt);
  }

  return orders.map(order => {
    const payment = latestPayment.get(order._id.toString());
    const receipt = latestReceipt.get(order._id.toString());

    return {
      id: order._id,
      ref: order.reference,
      userId: order.user?._id || order.user,
      studentName: order.user?.name || undefined,
      studentId: order.user?.studentId || undefined,
      productName: order.productName,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      total: order.total,
      type: order.type,
      paymentMethod: order.paymentMethod || (order.type === 'PURCHASE' ? 'GCASH' : 'CASH'),
      status: order.status,
      paymentId: payment?._id || null,
      paymentStatus: payment?.status || null,
      paymentReference: payment?.referenceNumber || '',
      paymentProofName: payment?.proofOriginalName || '',
      paymentRemarks: payment?.remarks || '',
      verifiedBy: includeVerifier && payment?.status === 'VERIFIED'
        ? verificationLabel(payment.verifiedBy)
        : '',
      receiptNumber: receipt?.receiptNumber || '',
      receiptStatus: receipt?.status || '',
      receiptIssuedAt: receipt?.issuedAt || null,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      cancelledAt: order.cancelledAt || null,
      cancelledBy: order.cancelledBy?.name || '',
      cancellationReason: order.cancellationReason || '',
      manualRefundRequired: Boolean(order.manualRefundRequired)
    };
  });
}

function canViewOrder(order, user) {
  return ['admin', 'cashier'].includes(user.role) ||
    order.user.toString() === user._id.toString();
}

function orderQrPayload(order, receipt) {
  return receipt
    ? `BIPSU-BLUEBOOK:RECEIPT:${receipt.receiptNumber}`
    : order.reference;
}

function createReferencePdf(order, receipt, qrImage, isCounterReservation) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.font('Helvetica-Bold').fontSize(20).text('BiPSU BlueBook', { align: 'center' });
    pdf.moveDown(0.5);
    pdf.fontSize(16).text(
      isCounterReservation ? 'Counter Payment Reference' : 'BlueBook Claim Receipt',
      { align: 'center' }
    );
    pdf.moveDown();
    pdf.font('Helvetica').fontSize(11);
    pdf.text(`Order reference: ${order.reference}`);
    if (receipt) pdf.text(`Receipt number: ${receipt.receiptNumber}`);
    pdf.text(`Bluebook: ${String(order.productName).slice(0, 120)}`);
    pdf.text(`Quantity: ${order.quantity}`);
    pdf.text(`Amount: PHP ${Number(order.total).toFixed(2)}`);
    pdf.text(`Payment method: ${order.paymentMethod === 'CASH' ? 'At counter' : order.paymentMethod}`);

    if (isCounterReservation) {
      pdf.text(`Payment due by: ${order.expiresAt ? order.expiresAt.toLocaleString() : 'Not specified'}`);
      pdf.moveDown(0.5);
      pdf.font('Helvetica-Bold').text('PAYMENT DUE — NOT YET PAID');
    } else {
      pdf.text(`Payment status: ${order.status === 'CLAIMED' ? 'Claimed' : 'Paid'}`);
      pdf.text(`Receipt issued: ${receipt.issuedAt.toLocaleString()}`);
    }

    pdf.image(qrImage, (pdf.page.width - 190) / 2, pdf.y + 18, { width: 190 });
    pdf.y += 220;
    pdf.font('Helvetica').fontSize(9).fillColor('#555555').text(
      isCounterReservation
        ? 'Show this QR and reference to the Bluebook cashier. The cashier must record your cash payment before a claim receipt is issued.'
        : 'Present this paid claim receipt and QR at the Bluebook counter. Staff must verify the order before releasing the Bluebook.',
      { align: 'center' }
    );
    pdf.end();
  });
}

// ============================================
// 1. CREATE ORDER AND RESERVE STOCK
// ============================================

router.post('/', async (req, res, next) => {
  let allocatedId = null;
  let quantity = 0;

  try {
    const { productId, type } = req.body;
    quantity = Number(req.body.quantity);
    const paymentMethod = String(
      req.body.paymentMethod || (type === 'PURCHASE' ? 'GCASH' : 'CASH')
    ).toUpperCase();

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({
        message: 'Invalid Bluebook product.'
      });
    }

    if (!['RESERVATION', 'PURCHASE'].includes(type)) {
      return res.status(400).json({
        message: 'Choose reservation or purchase.'
      });
    }

    if (!['GCASH', 'MAYA', 'CASH'].includes(paymentMethod) ||
        (type === 'PURCHASE' && paymentMethod === 'CASH')) {
      return res.status(400).json({
        message: 'Online purchases use GCash or Maya; reservations may also use the payment counter.'
      });
    }

    const orderSettings = await getOrderSettings();
    if (!isValidOrderQuantity(quantity, orderSettings.maxOrderQuantity)) {
      return res.status(400).json({
        message: `Quantity must be a whole number between 1 and ${orderSettings.maxOrderQuantity}.`
      });
    }

    const product = await Product.findOneAndUpdate(
      {
        _id: productId,
        active: true,
        $expr: {
          $gte: [
            { $subtract: ['$onHand', '$reserved'] },
            quantity
          ]
        }
      },
      {
        $inc: { reserved: quantity }
      },
      { new: true }
    );

    if (!product) {
      return res.status(409).json({
        message: 'Insufficient Bluebook stock. Please refresh availability.'
      });
    }

    allocatedId = product._id;

    const reference =
      `BB-${Date.now().toString().slice(-8)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const counterExpirationHours = paymentMethod === 'CASH'
      ? orderSettings.counterExpirationHours
      : 24;

    const order = await Order.create({
      reference,
      user: req.user._id,
      product: product._id,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      total: product.price * quantity,
      type,
      paymentMethod,
      status: ['GCASH', 'MAYA'].includes(paymentMethod) ? 'PENDING_PAYMENT' : 'RESERVED',
      expiresAt: new Date(Date.now() + counterExpirationHours * 60 * 60 * 1000)
    });

    res.status(201).json({
      order: {
        id: order._id,
        ref: order.reference,
        productName: order.productName,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        total: order.total,
        type: order.type,
        paymentMethod: order.paymentMethod,
        status: order.status,
        createdAt: order.createdAt,
        expiresAt: order.expiresAt
      }
    });

  } catch (error) {
    if (allocatedId) {
      try {
        const release = await Product.updateOne(
          {
            _id: allocatedId,
            reserved: { $gte: quantity }
          },
          {
            $inc: { reserved: -quantity }
          }
        );
        if (release.modifiedCount !== 1) {
          console.error('Could not release stock after order creation failed.');
        }
      } catch (cleanupError) {
        console.error('Could not release stock after order creation failed:', cleanupError.message);
      }
    }

    next(error);
  }
});

// ============================================
// 2. STUDENT: VIEW OWN ORDERS
// ============================================

router.get('/mine', requireRole('student'), async (req, res, next) => {
  try {
    const orders = await Order.find({
      user: req.user._id
    }).sort({ createdAt: -1 });

    res.json({ orders: await orderSummaries(orders) });

  } catch (error) {
    next(error);
  }
});

// ============================================
// 3. ADMIN/CASHIER: VIEW ALL ORDERS
// ============================================

router.get(
  '/',
  requireRole('admin', 'cashier', 'staff'),
  async (_req, res, next) => {
    try {
      const orders = await Order.find()
        .sort({ createdAt: -1 })
        .populate('user', 'name studentId email')
        .populate('cancelledBy', 'name role');

      res.json({ orders: await orderSummaries(orders, true) });

    } catch (error) {
      next(error);
    }
  }
);

router.patch('/:id/cancel', requireRole('admin', 'student'), async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const suppliedReason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    const reason = req.user.role === 'student'
      ? suppliedReason || 'Cancelled by student.'
      : suppliedReason;
    if (!reason || reason.length > 500) {
      return res.status(400).json({ message: 'Provide a cancellation reason of 1 to 500 characters.' });
    }

    let cancelledOrder;
    const cancelledAt = new Date();

    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) {
        throw Object.assign(new Error('Order not found.'), { status: 404 });
      }

      if (req.user.role === 'student' && order.user.toString() !== req.user._id.toString()) {
        throw Object.assign(new Error('You are not authorized to cancel this order.'), { status: 403 });
      }

      if (!['RESERVED', 'PENDING_PAYMENT', 'PAID'].includes(order.status)) {
        throw Object.assign(
          new Error('Only reserved, awaiting-payment, or paid-but-unclaimed orders can be cancelled.'),
          { status: 409 }
        );
      }

      const isPaid = order.status === 'PAID';
      if (isPaid) {
        const verifiedPayment = await Payment.findOne({
          order: order._id,
          status: 'VERIFIED'
        }).session(session);
        if (!verifiedPayment) {
          throw Object.assign(
            new Error('The paid order has no verified payment record; check it before cancelling.'),
            { status: 409 }
          );
        }
      }

      const product = isPaid && order.stockDeductedAt
        ? await Product.findOneAndUpdate(
          { _id: order.product },
          { $inc: { onHand: order.quantity } },
          { new: true, session }
        )
        : await Product.findOneAndUpdate(
          {
            _id: order.product,
            reserved: { $gte: order.quantity }
          },
          { $inc: { reserved: -order.quantity } },
          { new: true, session }
        );

      if (!product) {
        throw Object.assign(
          new Error('Unable to restore or release the reserved stock. Check inventory before cancelling.'),
          { status: 409 }
        );
      }

      order.status = 'CANCELLED';
      order.cancelledAt = cancelledAt;
      order.cancelledBy = req.user._id;
      order.cancellationReason = reason;
      order.manualRefundRequired = isPaid;
      await order.save({ session });

      await Payment.updateMany(
        { order: order._id, status: 'PENDING' },
        { $set: { status: 'CANCELLED', remarks: `Order cancelled by ${req.user.role}.` } },
        { session }
      );

      if (isPaid) {
        await Receipt.updateMany(
          { order: order._id, status: 'ISSUED' },
          { $set: { status: 'VOID' } },
          { session }
        );
      }

      cancelledOrder = order;
    });

    res.json({
      message: cancelledOrder.manualRefundRequired
        ? 'Order cancelled and retained in reports. Stock returned to availability; process any refund manually.'
        : 'Order cancelled and retained in reports. Reserved stock was released.',
      order: {
        id: cancelledOrder._id,
        reference: cancelledOrder.reference,
        status: cancelledOrder.status,
        cancelledAt: cancelledOrder.cancelledAt,
        manualRefundRequired: cancelledOrder.manualRefundRequired
      }
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
});

// ============================================
// 4. GENERATE COUNTER-LOOKUP OR CLAIM QR CODE
// ============================================

router.get('/:id/qr', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid order ID.'
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        message: 'Order not found.'
      });
    }

    if (!canViewOrder(order, req.user)) {
      return res.status(403).json({
        message: 'You are not authorized to view this QR code.'
      });
    }

    const isCounterReservation =
      order.paymentMethod === 'CASH' &&
      order.status === 'RESERVED' &&
      (!order.expiresAt || order.expiresAt > new Date());

    if (order.paymentMethod === 'CASH' && order.status === 'RESERVED' && !isCounterReservation) {
      return res.status(409).json({ message: 'This counter reservation has expired.' });
    }

    if (!isCounterReservation && !['PAID', 'CLAIMED'].includes(order.status)) {
      return res.status(409).json({
        message: 'An online claim QR code is available only after payment is confirmed.'
      });
    }

    const receipt = isCounterReservation ? null : await Receipt.findOne({
      order: order._id,
      status: { $in: ['ISSUED', 'CLAIMED'] }
    })
      .select('receiptNumber payment order student amount status')
      .populate('payment', 'order student method amount status');

    if (!isCounterReservation && !receipt) {
      return res.status(404).json({ message: 'The paid order receipt was not found.' });
    }
    if (receipt) assertVerifiedReceipt(receipt);

    const qr = await QRCode.toDataURL(orderQrPayload(order, receipt), {
      errorCorrectionLevel: 'H',
      width: 400,
      margin: 2
    });

    res.json({
      reference: order.reference,
      receiptNumber: receipt?.receiptNumber || '',
      purpose: isCounterReservation ? 'COUNTER_PAYMENT' : 'CLAIM',
      qr,
      status: order.status
    });

  } catch (error) {
    next(error);
  }
});

router.get('/:id/reference.pdf', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found.' });
    if (!canViewOrder(order, req.user)) {
      return res.status(403).json({ message: 'You are not authorized to download this reference.' });
    }

    const isCounterReservation =
      order.paymentMethod === 'CASH' &&
      order.status === 'RESERVED' &&
      (!order.expiresAt || order.expiresAt > new Date());

    if (order.paymentMethod === 'CASH' && order.status === 'RESERVED' && !isCounterReservation) {
      return res.status(409).json({ message: 'This counter reservation has expired.' });
    }

    if (!isCounterReservation && !['PAID', 'CLAIMED'].includes(order.status)) {
      return res.status(409).json({
        message: 'A downloadable claim receipt is available only after payment is confirmed.'
      });
    }

    const receipt = isCounterReservation ? null : await Receipt.findOne({
      order: order._id,
      status: { $in: ['ISSUED', 'CLAIMED'] }
    })
      .select('receiptNumber payment order student amount status')
      .populate('payment', 'order student method amount status');

    if (!isCounterReservation && !receipt) {
      return res.status(404).json({ message: 'The paid order receipt was not found.' });
    }
    if (receipt) assertVerifiedReceipt(receipt);

    const qrImage = await QRCode.toBuffer(orderQrPayload(order, receipt), {
      type: 'png',
      errorCorrectionLevel: 'H',
      width: 400,
      margin: 2
    });
    const pdfBuffer = await createReferencePdf(order, receipt, qrImage, isCounterReservation);
    const filename = isCounterReservation
      ? `BlueBook-${order.reference}-counter-payment.pdf`
      : `BlueBook-${receipt.receiptNumber}-claim-receipt.pdf`;

    res.type('application/pdf');
    res.attachment(filename);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// ============================================
// 5. CASHIER/ADMIN: CLAIM BLUEBOOK
// ============================================

router.post(
  '/scan-claim',
  requireRole('admin', 'cashier'),
  async (req, res, next) => {
    try {
      res.json(await scanClaimReceipt(req.body.qrContent, req.user));
    } catch (error) {
      if (error.status && error.status < 500) {
        return res.status(error.status).json({ message: error.message });
      }
      next(error);
    }
  }
);

router.patch(
  '/:id/claim',
  requireRole('admin', 'cashier'),
  async (req, res, next) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({
          message: 'Invalid order ID.'
        });
      }

      const claimedOrder = await claimPaidOrder(req.params.id, req.user);

      res.json({
        message: 'Bluebook successfully released and inventory updated.',
        order: {
          id: claimedOrder._id,
          reference: claimedOrder.reference,
          productName: claimedOrder.productName,
          quantity: claimedOrder.quantity,
          status: claimedOrder.status,
          claimedAt: claimedOrder.claimedAt
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

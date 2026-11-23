
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');

const Payment = require('../models/Payment');
const Receipt = require('../models/Receipt');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { requireAuth, requireRole } = require('../middleware/auth');
const proofStorage = require('../services/paymentProofStorage');

const router = express.Router();

router.use(requireAuth);

const uploadTempDirectory = proofStorage.uploadTempDirectory;
const maxProofSize = process.env.VERCEL ? 4 * 1024 * 1024 : 5 * 1024 * 1024;
const maxProofSizeLabel = process.env.VERCEL ? '4 MB' : '5 MB';
fs.mkdirSync(uploadTempDirectory, { recursive: true });

const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadTempDirectory,
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
  }),
  limits: { fileSize: maxProofSize, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, imageMimeTypes.has(file.mimetype))
});

function receiveProof(req, res, next) {
  upload.single('proof')(req, res, error => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        message: tooLarge
          ? `Payment receipt image must be ${maxProofSizeLabel} or smaller.`
          : 'Upload one payment receipt image.'
      });
    }
    if (error) return next(error);
    return next();
  });
}

function detectedImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

async function removeUploadedFile(file) {
  if (!file) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function publicPayment(payment) {
  return {
    id: payment._id,
    orderId: payment.order?._id || payment.order,
    orderReference: payment.order?.reference || '',
    orderProductName: payment.order?.productName || '',
    orderQuantity: payment.order?.quantity ?? null,
    orderTotal: payment.order?.total ?? null,
    studentId: payment.student?._id || payment.student,
    studentName: payment.student?.name,
    studentNumber: payment.student?.studentId,
    studentEmail: payment.student?.email,
    method: payment.method,
    amount: payment.amount,
    referenceNumber: payment.referenceNumber,
    proofName: payment.proofOriginalName,
    proofAvailable: Boolean(payment.proofPath),
    status: payment.status,
    verifiedAt: payment.verifiedAt,
    verifiedBy: payment.verifiedBy?.name,
    remarks: payment.remarks,
    createdAt: payment.createdAt
  };
}

function generateReceiptNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `BB-${date}-${random}`;
}

// STUDENT: Submit online wallet payment proof for manual staff verification
router.post('/online', requireRole('student'), receiveProof, async (req, res, next) => {
  let payment;
  let proofKey;
  try {
    const { orderId } = req.body;

    if (!mongoose.isValidObjectId(orderId)) {
      await removeUploadedFile(req.file);
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    if (!req.file) {
      return res.status(400).json({
        message: 'Upload a JPEG, PNG, or WebP image of your GCash or Maya receipt.'
      });
    }

    const fileBuffer = await fs.promises.readFile(req.file.path);
    if (detectedImageType(fileBuffer) !== req.file.mimetype) {
      await removeUploadedFile(req.file);
      return res.status(400).json({ message: 'The uploaded file is not a supported receipt image.' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
      paymentMethod: { $in: ['GCASH', 'MAYA'] },
      status: 'PENDING_PAYMENT',
      expiresAt: { $gt: new Date() }
    });

    if (!order) {
      await removeUploadedFile(req.file);
      return res.status(404).json({
        message: 'An active online order awaiting payment was not found.'
      });
    }

    const existingPayment = await Payment.findOne({
      order: order._id,
      status: 'PENDING'
    });

    if (existingPayment) {
      await removeUploadedFile(req.file);
      return res.status(409).json({
        message: 'A payment submission is already awaiting verification.'
      });
    }

    proofKey = `${crypto.randomUUID()}.proof`;
    await proofStorage.store(proofKey, fileBuffer, req.file.mimetype);
    await removeUploadedFile(req.file);

    payment = await Payment.create({
      order: order._id,
      student: req.user._id,
      method: order.paymentMethod,
      amount: order.total,
      referenceNumber: `BB-${order.paymentMethod}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      proofPath: proofKey,
      proofOriginalName: req.file.originalname.slice(0, 255),
      proofMimeType: req.file.mimetype,
      proofUploadedAt: new Date(),
      status: 'PENDING'
    });

    res.status(201).json({
      message: `${order.paymentMethod === 'MAYA' ? 'Maya' : 'GCash'} receipt submitted. Payment and stock will be confirmed only after staff verification.`,
      payment: publicPayment(payment)
    });
  } catch (error) {
    let cleanupError;
    let paymentRemoved = !payment;

    if (payment) {
      try {
        const deletion = await Payment.deleteOne({ _id: payment._id });
        if (deletion.deletedCount !== 1) {
          throw new Error('Created payment could not be removed after proof-storage failure.');
        }
        paymentRemoved = true;
      } catch (paymentCleanupError) {
        cleanupError = paymentCleanupError;
      }
    }

    if (proofKey && paymentRemoved) {
      try {
        await proofStorage.remove(proofKey);
      } catch (storageCleanupError) {
        cleanupError = storageCleanupError;
      }
    }

    try {
      await removeUploadedFile(req.file);
    } catch (tempCleanupError) {
      if (!cleanupError) cleanupError = tempCleanupError;
    }

    next(cleanupError || error);
  }
});

// STUDENT: View own payment history
router.get('/my', requireRole('student'), async (req, res, next) => {
  try {
    const payments = await Payment.find({
      student: req.user._id
    })
      .populate('order', 'reference productName quantity total status')
      .sort({ createdAt: -1 });

    const receipts = await Receipt.find({
      student: req.user._id
    }).sort({ issuedAt: -1 });

    res.json({ payments: payments.map(publicPayment), receipts });
  } catch (error) {
    next(error);
  }
});

// ADMIN/CASHIER: View all payment transactions
router.get('/', requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    const payments = await Payment.find()
      .populate('student', 'name studentId email')
      .populate('order', 'reference productName quantity total status')
      .populate('verifiedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ payments: payments.map(publicPayment) });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/proof', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid payment ID.' });
    }

    const payment = await Payment.findById(req.params.id)
      .select('student proofPath proofMimeType');
    if (!payment || !payment.proofPath || !proofStorage.isValidProofKey(payment.proofPath)) {
      return res.status(404).json({ message: 'Payment receipt image was not found.' });
    }

    const isStaff = ['admin', 'cashier'].includes(req.user.role);
    if (!isStaff && payment.student.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not authorized to view this receipt.' });
    }

    res.setHeader('Content-Type', payment.proofMimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const proof = await proofStorage.read(payment.proofPath);
    return res.send(proof);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'Payment receipt image was not found.' });
    }
    next(error);
  }
});

// ADMIN/CASHIER: Verify a submitted online-wallet payment
router.patch('/:id/verify', requireRole('admin', 'cashier'), async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid payment ID.' });
    }

    let result;

    await session.withTransaction(async () => {
      const payment = await Payment.findOne({
        _id: req.params.id,
        method: { $in: ['GCASH', 'MAYA'] },
        status: 'PENDING',
        proofPath: { $exists: true, $ne: '' }
      }).session(session);

      if (!payment) {
        throw Object.assign(
          new Error('Pending online payment not found or already processed.'),
          { status: 404 }
        );
      }

      const order = await Order.findOne({
        _id: payment.order,
        user: payment.student,
        paymentMethod: payment.method,
        status: 'PENDING_PAYMENT'
      }).session(session);

      if (!order) {
        throw Object.assign(
          new Error('The associated order is not awaiting payment.'),
          { status: 400 }
        );
      }

      if (order.expiresAt && order.expiresAt <= new Date()) {
        throw Object.assign(
          new Error('This order has expired.'),
          { status: 400 }
        );
      }

      if (payment.amount !== order.total) {
        throw Object.assign(
          new Error('Payment amount does not match the order total.'),
          { status: 400 }
        );
      }

      const product = await Product.findOneAndUpdate(
        {
          _id: order.product,
          onHand: { $gte: order.quantity },
          reserved: { $gte: order.quantity }
        },
        {
          $inc: {
            onHand: -order.quantity,
            reserved: -order.quantity
          }
        },
        { new: true, session }
      );

      if (!product) {
        throw Object.assign(
          new Error('Unable to deduct stock for the verified payment. Please check inventory.'),
          { status: 409 }
        );
      }

      payment.status = 'VERIFIED';
      payment.verifiedBy = req.user._id;
      payment.verifiedAt = new Date();
      payment.remarks = 'Payment verified by authorized cashier/admin.';
      await payment.save({ session });

      order.status = 'PAID';
      order.paidAt = new Date();
      order.stockDeductedAt = new Date();
      await order.save({ session });

      const [receipt] = await Receipt.create([{
        receiptNumber: generateReceiptNumber(),
        payment: payment._id,
        order: order._id,
        student: payment.student,
        amount: payment.amount,
        status: 'ISSUED'
      }], { session });

      result = {
        payment,
        order,
        receipt
      };
    });

    res.json({
      message: 'Online payment verified, stock deducted, and receipt issued.',
      payment: publicPayment(result.payment),
      order: {
        id: result.order._id,
        reference: result.order.reference,
        status: result.order.status,
        paidAt: result.order.paidAt
      },
      receipt: result.receipt
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
});

// ADMIN/CASHIER: Reject a submitted online-wallet payment proof
router.patch('/:id/reject', requireRole('admin', 'cashier'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid payment ID.' });
    }

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) {
      return res.status(400).json({ message: 'Provide a reason for rejecting the receipt.' });
    }

    const pending = await Payment.findOne({
      _id: req.params.id,
      method: { $in: ['GCASH', 'MAYA'] },
      status: 'PENDING',
      proofPath: { $exists: true, $ne: '' }
    });

    if (!pending) {
      return res.status(404).json({ message: 'Pending online payment not found or already processed.' });
    }

    const order = await Order.findOne({
      _id: pending.order,
      user: pending.student,
      paymentMethod: pending.method,
      status: 'PENDING_PAYMENT',
      expiresAt: { $gt: new Date() }
    });

    if (!order) {
      return res.status(409).json({
        message: 'The order is no longer active. Its stock reservation may already have expired.'
      });
    }

    const payment = await Payment.findOneAndUpdate(
      { _id: req.params.id, method: pending.method, status: 'PENDING' },
      {
        $set: {
          status: 'REJECTED',
          verifiedBy: req.user._id,
          verifiedAt: new Date(),
          remarks
        }
      },
      { new: true, runValidators: true }
    );

    if (!payment) {
      return res.status(404).json({ message: 'Pending online payment not found or already processed.' });
    }

    res.json({
      message: 'Receipt rejected. The student may submit a corrected receipt before the order expires.',
      payment: publicPayment(payment)
    });
  } catch (error) {
    next(error);
  }
});

// ADMIN/CASHIER: Record an on-site cash payment
router.post('/counter', requireRole('admin', 'cashier'), async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    const { orderId } = req.body;

    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: 'Invalid order ID.' });
    }

    let result;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        type: 'RESERVATION',
        $or: [{ paymentMethod: 'CASH' }, { paymentMethod: { $exists: false } }],
        status: 'RESERVED'
      }).session(session);

      if (!order) {
        throw Object.assign(
          new Error('Active reservation not found or already paid.'),
          { status: 404 }
        );
      }

      if (order.expiresAt && order.expiresAt <= new Date()) {
        throw Object.assign(
          new Error('This reservation has expired.'),
          { status: 400 }
        );
      }

      const [payment] = await Payment.create([{
        order: order._id,
        student: order.user,
        method: 'CASH',
        amount: order.total,
        status: 'VERIFIED',
        verifiedBy: req.user._id,
        verifiedAt: new Date(),
        remarks: 'Cash payment received at the counter.'
      }], { session });

      order.status = 'PAID';
      order.paidAt = new Date();
      await order.save({ session });

      const [receipt] = await Receipt.create([{
        receiptNumber: generateReceiptNumber(),
        payment: payment._id,
        order: order._id,
        student: order.user,
        amount: payment.amount,
        status: 'ISSUED'
      }], { session });

      result = { payment, order, receipt };
    });

    res.status(201).json({
      message: 'Cash payment recorded and receipt issued.',
      ...result
    });
  } catch (error) {
    next(error);
  } finally {
    await session.endSession();
  }
});

// STUDENT/ADMIN/CASHIER: Retrieve a receipt
router.get('/receipt/:id', async (req, res, next) => {
  try {
    const isObjectId = mongoose.isValidObjectId(req.params.id);

    const receipt = await Receipt.findOne({
      $or: [
        ...(isObjectId ? [{ _id: req.params.id }] : []),
        { receiptNumber: req.params.id }
      ]
    })
      .populate('student', 'name studentId email')
      .populate('order', 'reference productName quantity total')
      .populate('payment', 'method referenceNumber status');

    if (!receipt) {
      return res.status(404).json({ message: 'Receipt not found.' });
    }

    const isStaff = ['admin', 'cashier'].includes(req.user.role);
    const isOwner = receipt.student._id.toString() === req.user._id.toString();

    if (!isStaff && !isOwner) {
      return res.status(403).json({
        message: 'You are not authorized to view this receipt.'
      });
    }

    res.json(receipt);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

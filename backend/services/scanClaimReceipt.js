const mongoose = require('mongoose');
const Order = require('../models/Order');
const Receipt = require('../models/Receipt');
const claimPaidOrder = require('./claimPaidOrder');
const assertVerifiedReceipt = require('./assertVerifiedReceipt');

function findReceipt(filter) {
  return Receipt.findOne(filter)
    .select('order status receiptNumber payment student amount')
    .populate('payment', 'order student method amount status')
    .lean();
}

async function scanClaimReceipt(qrContent, claimant) {
  const content = String(qrContent || '').trim();
  const receiptPrefix = 'BIPSU-BLUEBOOK:RECEIPT:';
  const hasReceiptPrefix = content.startsWith(receiptPrefix);
  const receiptNumber = hasReceiptPrefix
    ? content.slice(receiptPrefix.length)
    : content;

  if (
    content.length > 128 ||
    !/^BB-[A-Z0-9-]{4,40}$/.test(receiptNumber) ||
    (content.includes(':') && !hasReceiptPrefix)
  ) {
    throw Object.assign(
      new Error('This is not a valid Bluebook receipt QR code.'),
      { status: 400 }
    );
  }

  let receipt = await findReceipt({ receiptNumber });

  let orderId = receipt?.order;
  if (!receipt && !hasReceiptPrefix) {
    const legacyOrder = await Order.findOne({ reference: content }).select('_id').lean();
    orderId = legacyOrder?._id;
    if (orderId) {
      receipt = await findReceipt({ order: orderId, status: 'ISSUED' });
    }
  }

  if (!orderId) {
    throw Object.assign(
      new Error('No matching Bluebook receipt was found.'),
      { status: 404 }
    );
  }

  if (!receipt) {
    throw Object.assign(
      new Error('No active claim receipt is available for this order.'),
      { status: 409 }
    );
  }

  if (receipt.status !== 'ISSUED') {
    throw Object.assign(
      new Error(receipt.status === 'CLAIMED'
        ? 'This receipt has already been claimed.'
        : 'This receipt is void and cannot be used.'),
      { status: 409 }
    );
  }

  const verifiedPayment = assertVerifiedReceipt(receipt);

  if (!mongoose.isValidObjectId(orderId)) {
    throw Object.assign(
      new Error('The receipt does not contain a valid order reference.'),
      { status: 400 }
    );
  }

  const claimedOrder = await claimPaidOrder(orderId, claimant, {
    requireIssuedReceipt: true,
    receiptNumber: receipt.receiptNumber,
    receiptPaymentId: verifiedPayment._id
  });
  const [claimedReceipt, orderDetails] = await Promise.all([
    Receipt.findOne({ order: claimedOrder._id, status: 'CLAIMED' })
      .select('receiptNumber status')
      .lean(),
    Order.findById(claimedOrder._id)
      .populate('user', 'name studentId')
      .lean()
  ]);

  return {
    message: 'Receipt verified and the order was marked claimed.',
    receipt: claimedReceipt,
    paymentMethod: verifiedPayment.method,
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
  };
}

module.exports = scanClaimReceipt;

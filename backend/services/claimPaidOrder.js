const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Payment = require('../models/Payment');
const Receipt = require('../models/Receipt');

async function claimPaidOrder(
  orderId,
  cashier,
  { requireIssuedReceipt = false, receiptNumber, receiptPaymentId } = {}
) {
  const session = await mongoose.startSession();
  let claimedOrder;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        status: 'PAID'
      }).session(session);

      if (!order) {
        throw Object.assign(
          new Error('Order must be paid before the Bluebook can be released.'),
          { status: 409 }
        );
      }

      const verifiedPaymentFilter = {
        order: order._id,
        status: 'VERIFIED'
      };
      if (receiptPaymentId) verifiedPaymentFilter._id = receiptPaymentId;
      const verifiedPayment = await Payment.findOne(verifiedPaymentFilter).session(session);
      if (
        !verifiedPayment ||
        verifiedPayment.method !== (order.paymentMethod || 'CASH') ||
        verifiedPayment.amount !== order.total ||
        String(verifiedPayment.student) !== String(order.user)
      ) {
        throw Object.assign(
          new Error('A matching verified payment is required before the Bluebook can be released.'),
          { status: 409 }
        );
      }

      if (requireIssuedReceipt) {
        const receiptFilter = {
          order: order._id,
          status: 'ISSUED'
        };
        if (receiptNumber) receiptFilter.receiptNumber = receiptNumber;
        if (receiptPaymentId) receiptFilter.payment = receiptPaymentId;
        const receipt = await Receipt.findOne(receiptFilter).session(session);
        if (!receipt) {
          throw Object.assign(
            new Error('An active claim receipt is required to scan this order.'),
            { status: 409 }
          );
        }
      }

      if (!order.stockDeductedAt) {
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
          {
            new: true,
            session
          }
        );

        if (!product) {
          throw Object.assign(
            new Error('Unable to release stock. Please check inventory.'),
            { status: 409 }
          );
        }
      }

      claimedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: 'PAID'
        },
        {
          $set: {
            status: 'CLAIMED',
            claimedAt: new Date(),
            claimedBy: cashier._id
          }
        },
        {
          new: true,
          session
        }
      );

      if (!claimedOrder) {
        throw Object.assign(
          new Error('Order was already processed.'),
          { status: 409 }
        );
      }

      await Receipt.updateMany(
        {
          order: order._id,
          status: 'ISSUED'
        },
        {
          $set: {
            status: 'CLAIMED',
            claimedAt: claimedOrder.claimedAt,
            claimedBy: cashier._id
          }
        },
        { session }
      );
    });

    return claimedOrder;
  } finally {
    await session.endSession();
  }
}

module.exports = claimPaidOrder;

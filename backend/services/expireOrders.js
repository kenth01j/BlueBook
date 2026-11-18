
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');

async function expirePendingOrders() {
  const now = new Date();

  const expiredOrders = await Order.find({
    status: { $in: ['RESERVED', 'PENDING_PAYMENT'] },
    expiresAt: { $lte: now }
  }).select('_id');

  for (const candidate of expiredOrders) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const order = await Order.findOneAndUpdate(
          {
            _id: candidate._id,
            status: { $in: ['RESERVED', 'PENDING_PAYMENT'] },
            expiresAt: { $lte: now }
          },
          { $set: { status: 'EXPIRED' } },
          { new: true, session }
        );

        if (!order) return;

        const stock = await Product.updateOne(
          {
            _id: order.product,
            reserved: { $gte: order.quantity }
          },
          { $inc: { reserved: -order.quantity } },
          { session }
        );

        if (stock.modifiedCount !== 1) {
          throw new Error(
            `Could not release reserved stock for order ${order.reference}`
          );
        }

        console.log(
          `Expired order ${order.reference}; released ${order.quantity} reserved unit(s).`
        );
      });
    } catch (error) {
      console.error(
        `Failed to expire order ${candidate._id}:`,
        error.message
      );
    } finally {
      await session.endSession();
    }
  }
}

module.exports = expirePendingOrders;

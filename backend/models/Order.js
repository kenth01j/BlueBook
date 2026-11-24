const mongoose = require('mongoose');
const orderSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  school: { type: String, trim: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ['RESERVATION', 'PURCHASE'], required: true },
  paymentMethod: { type: String, enum: ['GCASH', 'MAYA', 'CASH'] },
  status: { type: String, enum: ['RESERVED', 'PENDING_PAYMENT', 'PAID', 'CLAIMED', 'EXPIRED', 'CANCELLED'], default: 'RESERVED', index: true },
  expiresAt: Date,
  paidAt: Date,
  claimedAt: Date,
  claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  stockDeductedAt: Date,
  cancelledAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancellationReason: { type: String, trim: true, maxlength: 500, default: '' },
  manualRefundRequired: { type: Boolean, default: false }
}, { timestamps: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ claimedBy: 1, status: 1, claimedAt: -1 });
module.exports = mongoose.model('Order', orderSchema);


const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  receiptNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  payment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true,
    unique: true
  },

  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true,
    index: true
  },

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  issuedAt: {
    type: Date,
    default: Date.now
  },

  claimedAt: {
    type: Date,
    default: null
  },

  claimedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  status: {
    type: String,
    enum: ['ISSUED', 'CLAIMED', 'VOID'],
    default: 'ISSUED'
  }

}, {
  timestamps: true
});

receiptSchema.index({ student: 1, issuedAt: -1 });

module.exports = mongoose.model('Receipt', receiptSchema);

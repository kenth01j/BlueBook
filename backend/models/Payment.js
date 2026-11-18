
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
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

  method: {
    type: String,
    enum: ['GCASH', 'MAYA', 'CASH', 'BANK_TRANSFER'],
    required: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  referenceNumber: {
    type: String,
    trim: true,
    default: ''
  },

  proofPath: {
    type: String,
    default: ''
  },

  proofOriginalName: {
    type: String,
    trim: true,
    maxlength: 255,
    default: ''
  },

  proofMimeType: {
    type: String,
    enum: ['', 'image/jpeg', 'image/png', 'image/webp'],
    default: ''
  },

  proofUploadedAt: {
    type: Date,
    default: null
  },

  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING',
    index: true
  },

  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  verifiedAt: {
    type: Date,
    default: null
  },

  remarks: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  }

}, {
  timestamps: true
});

paymentSchema.index({ student: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ verifiedBy: 1, verifiedAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);

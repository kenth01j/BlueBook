const mongoose = require('mongoose');
const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  onHand: { type: Number, required: true, min: 0, default: 0 },
  reserved: { type: Number, min: 0, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
productSchema.virtual('available').get(function () { return this.onHand - this.reserved; });
productSchema.set('toJSON', { virtuals: true });
module.exports = mongoose.model('Product', productSchema);

const mongoose = require('mongoose');

const rateLimitEntrySchema = new mongoose.Schema({
  _id: { type: String, required: true },
  totalHits: { type: Number, required: true },
  resetTime: { type: Date, required: true }
}, {
  collection: 'auth_rate_limits',
  versionKey: false
});

rateLimitEntrySchema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitEntry', rateLimitEntrySchema);

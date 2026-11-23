const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'bluebook' },
  counterExpirationHours: { type: Number, required: true, min: 1, max: 168, default: 8 }
}, { timestamps: true });

module.exports = mongoose.model('AppSettings', appSettingsSchema);

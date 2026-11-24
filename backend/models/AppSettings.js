const mongoose = require('mongoose');
const defaultSchools = require('../utils/schools');

const appSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'bluebook' },
  schools: { type: [String], default: defaultSchools },
  counterExpirationHours: { type: Number, required: true, min: 1, max: 168, default: 8 },
  maxOrderQuantity: {
    type: Number,
    required: true,
    min: 1,
    max: 1000,
    default: 20,
    validate: {
      validator: Number.isInteger,
      message: 'Maximum order quantity must be a whole number.'
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('AppSettings', appSettingsSchema);

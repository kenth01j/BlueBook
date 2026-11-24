const AppSettings = require('../models/AppSettings');

const DEFAULT_COUNTER_EXPIRATION_HOURS = 8;
const DEFAULT_MAX_ORDER_QUANTITY = 20;

function isValidOrderQuantity(quantity, maxOrderQuantity) {
  return Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= maxOrderQuantity;
}

async function getOrderSettings() {
  const settings = await AppSettings.findOne({ key: 'bluebook' })
    .select('counterExpirationHours maxOrderQuantity')
    .lean();
  return {
    counterExpirationHours: settings?.counterExpirationHours || DEFAULT_COUNTER_EXPIRATION_HOURS,
    maxOrderQuantity: settings?.maxOrderQuantity || DEFAULT_MAX_ORDER_QUANTITY
  };
}

module.exports = {
  getOrderSettings,
  isValidOrderQuantity,
  DEFAULT_COUNTER_EXPIRATION_HOURS,
  DEFAULT_MAX_ORDER_QUANTITY
};

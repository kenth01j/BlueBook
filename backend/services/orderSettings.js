const AppSettings = require('../models/AppSettings');

const DEFAULT_COUNTER_EXPIRATION_HOURS = 8;

async function getCounterExpirationHours() {
  const settings = await AppSettings.findOne({ key: 'bluebook' })
    .select('counterExpirationHours')
    .lean();
  return settings?.counterExpirationHours || DEFAULT_COUNTER_EXPIRATION_HOURS;
}

module.exports = { getCounterExpirationHours, DEFAULT_COUNTER_EXPIRATION_HOURS };

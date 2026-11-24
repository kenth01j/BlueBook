const AppSettings = require('../models/AppSettings');
const defaultSchools = require('../utils/schools');

async function ensureSchoolSettings() {
  let rawSettings = await AppSettings.findOne({ key: 'bluebook' })
    .select('schools')
    .lean();
  if (!rawSettings) {
    try {
      await AppSettings.findOneAndUpdate(
        { key: 'bluebook' },
        { $setOnInsert: { schools: defaultSchools } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      rawSettings = await AppSettings.findOne({ key: 'bluebook' })
        .select('schools')
        .lean();
      if (!rawSettings) throw error;
    }
  }

  if (!rawSettings) {
    rawSettings = await AppSettings.findOne({ key: 'bluebook' })
      .select('schools')
      .lean();
  }
  if (!rawSettings) {
    throw new Error('Unable to initialize application school settings.');
  }
  if (!Array.isArray(rawSettings.schools) || rawSettings.schools.length === 0) {
    const filter = { key: 'bluebook' };
    filter.schools = Array.isArray(rawSettings.schools)
      ? rawSettings.schools
      : { $exists: false };
    await AppSettings.updateOne(filter, { $set: { schools: defaultSchools } });
  }
  return AppSettings.findOne({ key: 'bluebook' });
}

async function getAvailableSchools() {
  const settings = await ensureSchoolSettings();
  return settings.schools;
}

function isAvailableSchool(school, availableSchools) {
  return typeof school === 'string' && availableSchools.includes(school);
}

module.exports = { ensureSchoolSettings, getAvailableSchools, isAvailableSchool };

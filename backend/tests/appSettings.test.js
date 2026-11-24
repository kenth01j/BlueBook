const test = require('node:test');
const assert = require('node:assert/strict');
const AppSettings = require('../models/AppSettings');

function settingsWithLimit(maxOrderQuantity) {
  return new AppSettings({ key: 'bluebook', maxOrderQuantity });
}

test('per-order quantity setting accepts an integer in the supported range', () => {
  assert.equal(settingsWithLimit(35).validateSync(), undefined);
});

test('per-order quantity setting rejects fractions and out-of-range values', () => {
  assert.equal(settingsWithLimit(2.5).validateSync().errors.maxOrderQuantity.kind, 'user defined');
  assert.equal(settingsWithLimit(0).validateSync().errors.maxOrderQuantity.kind, 'min');
  assert.equal(settingsWithLimit(1001).validateSync().errors.maxOrderQuantity.kind, 'max');
});

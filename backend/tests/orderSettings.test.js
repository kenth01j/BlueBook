const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidOrderQuantity } = require('../services/orderSettings');

test('order quantity validation enforces the configured limit', () => {
  assert.equal(isValidOrderQuantity(1, 5), true);
  assert.equal(isValidOrderQuantity(5, 5), true);
  assert.equal(isValidOrderQuantity(6, 5), false);
  assert.equal(isValidOrderQuantity(1.5, 5), false);
  assert.equal(isValidOrderQuantity(0, 5), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { isOrderWindowOpen } = require('../utils/orderWindow');

test('order window opens at 8 AM and closes at 5 PM Philippine time', () => {
  assert.equal(isOrderWindowOpen(new Date('2026-11-24T00:00:00.000Z')), true);
  assert.equal(isOrderWindowOpen(new Date('2026-11-24T08:59:00.000Z')), true);
  assert.equal(isOrderWindowOpen(new Date('2026-11-24T09:00:00.000Z')), false);
  assert.equal(isOrderWindowOpen(new Date('2026-11-23T23:59:00.000Z')), false);
});

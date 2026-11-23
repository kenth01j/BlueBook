const test = require('node:test');
const assert = require('node:assert/strict');
const assertVerifiedReceipt = require('../services/assertVerifiedReceipt');

function makeReceipt(method, status = 'VERIFIED') {
  return {
    order: 'order-1',
    student: 'student-1',
    amount: 25,
    payment: {
      order: 'order-1',
      student: 'student-1',
      amount: 25,
      method,
      status
    }
  };
}

test('accepts verified online and counter payments linked to the receipt', () => {
  for (const method of ['GCASH', 'MAYA', 'CASH']) {
    assert.equal(assertVerifiedReceipt(makeReceipt(method)).method, method);
  }
});

test('rejects unpaid or mismatched receipt payment records', () => {
  assert.throws(
    () => assertVerifiedReceipt(makeReceipt('GCASH', 'PENDING')),
    error => error.status === 409
  );
  assert.throws(
    () => assertVerifiedReceipt({
      ...makeReceipt('CASH'),
      payment: { ...makeReceipt('CASH').payment, amount: 20 }
    }),
    error => error.status === 409
  );
});

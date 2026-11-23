function assertVerifiedReceipt(receipt) {
  const payment = receipt?.payment;
  const validMethods = ['GCASH', 'MAYA', 'CASH'];
  const matchesReceipt = payment &&
    payment.status === 'VERIFIED' &&
    validMethods.includes(payment.method) &&
    String(payment.order) === String(receipt.order) &&
    String(payment.student) === String(receipt.student) &&
    Number(payment.amount) === Number(receipt.amount);

  if (!matchesReceipt) {
    throw Object.assign(
      new Error('The receipt is not linked to a verified online or counter payment.'),
      { status: 409 }
    );
  }

  return payment;
}

module.exports = assertVerifiedReceipt;

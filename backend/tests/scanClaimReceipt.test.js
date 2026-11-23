const test = require('node:test');
const assert = require('node:assert/strict');
const scanClaimReceipt = require('../services/scanClaimReceipt');

test('rejects invalid claim QR content before accessing receipts', async () => {
  await assert.rejects(
    scanClaimReceipt('not-a-bluebook-receipt', {}),
    error => error.status === 400 && /valid Bluebook receipt QR/.test(error.message)
  );
  await assert.rejects(
    scanClaimReceipt('BIPSU-BLUEBOOK:RECEIPT:invalid', {}),
    error => error.status === 400 && /valid Bluebook receipt QR/.test(error.message)
  );
});

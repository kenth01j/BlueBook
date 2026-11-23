const test = require('node:test');
const assert = require('node:assert/strict');
const isAuthorizedCronRequest = require('../utils/cronAuth');

test('accepts the exact bearer token', () => {
  assert.equal(isAuthorizedCronRequest('Bearer secure-cron-secret-1234', 'secure-cron-secret-1234'), true);
});

test('rejects a wrong token, missing token, or weak secret', () => {
  assert.equal(isAuthorizedCronRequest('Bearer another-secret-123456', 'secure-cron-secret-1234'), false);
  assert.equal(isAuthorizedCronRequest(undefined, 'secure-cron-secret-1234'), false);
  assert.equal(isAuthorizedCronRequest('Bearer short', 'short'), false);
});

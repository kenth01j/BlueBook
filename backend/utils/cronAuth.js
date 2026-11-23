const crypto = require('node:crypto');

function isAuthorizedCronRequest(authorization, secret) {
  if (typeof authorization !== 'string' || typeof secret !== 'string' || secret.length < 16) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = isAuthorizedCronRequest;

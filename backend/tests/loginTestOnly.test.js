const test = require('node:test');
const assert = require('node:assert/strict');
const loginTestOnly = require('../middleware/loginTestOnly');

function invokeMiddleware({ method, originalUrl }) {
  let statusCode;
  let responseBody;
  let nextCalled = false;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  loginTestOnly(
    { method, originalUrl },
    response,
    () => { nextCalled = true; }
  );

  return { statusCode, responseBody, nextCalled };
}

test('login-test-only mode allows sign-in and read-only requests', () => {
  const original = process.env.LOGIN_TEST_ONLY;
  process.env.LOGIN_TEST_ONLY = 'true';
  try {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/auth/login' }).nextCalled, true);
    assert.equal(invokeMiddleware({ method: 'GET', originalUrl: '/api/orders' }).nextCalled, true);
  } finally {
    if (original === undefined) delete process.env.LOGIN_TEST_ONLY;
    else process.env.LOGIN_TEST_ONLY = original;
  }
});

test('login-test-only mode rejects writes and payment endpoints', () => {
  const original = process.env.LOGIN_TEST_ONLY;
  process.env.LOGIN_TEST_ONLY = 'true';
  try {
    const write = invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' });
    assert.equal(write.statusCode, 503);
    assert.match(write.responseBody.message, /Write operations are disabled/);

    const paymentRead = invokeMiddleware({ method: 'GET', originalUrl: '/api/payments/123/proof' });
    assert.equal(paymentRead.statusCode, 503);
    assert.match(paymentRead.responseBody.message, /Payment features are disabled/);
  } finally {
    if (original === undefined) delete process.env.LOGIN_TEST_ONLY;
    else process.env.LOGIN_TEST_ONLY = original;
  }
});

test('normal mode leaves requests unchanged', () => {
  const original = process.env.LOGIN_TEST_ONLY;
  delete process.env.LOGIN_TEST_ONLY;
  try {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' }).nextCalled, true);
  } finally {
    if (original !== undefined) process.env.LOGIN_TEST_ONLY = original;
  }
});

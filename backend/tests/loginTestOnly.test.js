const test = require('node:test');
const assert = require('node:assert/strict');
const loginTestOnly = require('../middleware/loginTestOnly');

function withEnv(values, callback) {
  const originals = new Map(
    Object.keys(values).map(key => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    callback();
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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
  withEnv({ LOGIN_TEST_ONLY: 'true', NODE_ENV: undefined, RENDER: undefined }, () => {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/auth/login' }).nextCalled, true);
    assert.equal(invokeMiddleware({ method: 'GET', originalUrl: '/api/orders' }).nextCalled, true);
  });
});

test('login-test-only mode rejects writes and payment endpoints', () => {
  withEnv({ LOGIN_TEST_ONLY: 'true', NODE_ENV: undefined, RENDER: undefined }, () => {
    const write = invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' });
    assert.equal(write.statusCode, 503);
    assert.match(write.responseBody.message, /Write operations are disabled/);

    const paymentRead = invokeMiddleware({ method: 'GET', originalUrl: '/api/payments/123/proof' });
    assert.equal(paymentRead.statusCode, 503);
    assert.match(paymentRead.responseBody.message, /Payment features are disabled/);
  });
});

test('normal mode leaves requests unchanged', () => {
  withEnv({ LOGIN_TEST_ONLY: undefined }, () => {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' }).nextCalled, true);
  });
});

test('hosted production deployments cannot be left in login-test-only mode', () => {
  withEnv({ LOGIN_TEST_ONLY: 'true', NODE_ENV: 'production' }, () => {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' }).nextCalled, true);
  });
  withEnv({ LOGIN_TEST_ONLY: 'true', NODE_ENV: undefined, RENDER: 'true' }, () => {
    assert.equal(invokeMiddleware({ method: 'POST', originalUrl: '/api/orders' }).nextCalled, true);
  });
});

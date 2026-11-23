const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

module.exports = function loginTestOnly(req, res, next) {
  if (process.env.LOGIN_TEST_ONLY !== 'true') return next();

  const method = req.method.toUpperCase();
  const requestPath = req.originalUrl.split('?')[0];

  if (requestPath.startsWith('/api/payments')) {
    return res.status(503).json({ message: 'Payment features are disabled in login-test-only mode.' });
  }
  if (method === 'POST' && requestPath === '/api/auth/login') return next();
  if (readMethods.has(method)) return next();

  return res.status(503).json({ message: 'Write operations are disabled in login-test-only mode.' });
};

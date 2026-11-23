module.exports = function isLoginTestOnly() {
  return process.env.LOGIN_TEST_ONLY === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    !process.env.RENDER;
};

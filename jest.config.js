/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  // The fake firebase and other helpers under test/ are not themselves tests.
  testPathIgnorePatterns: ['/node_modules/', '/test/helpers/'],
  clearMocks: true,
};

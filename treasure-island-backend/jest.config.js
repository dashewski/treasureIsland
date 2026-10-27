/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  setupFiles: ["<rootDir>/src/testing/setupEnv.ts"],
  // tests that use the database share one test database, so files run one at a time
  maxWorkers: 1,
};

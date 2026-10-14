/**
 * Jest configuration for the e2e tests (`test/*.e2e-spec.ts`): the API on a
 * real Postgres and Redis from docker-compose (docs/07 §5).
 *
 *   docker compose up -d
 *   npm run test:e2e
 *
 * It reuses the transform of the unit tests (jest.config.js): NestJS 12
 * packages are ES modules only and are turned into CommonJS for Jest.
 * The script runs the files one after another (--runInBand): they share the
 * test database, which every test empties first.
 *
 * @type {import('jest').Config}
 */
const unit = require('../jest.config.js');

module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: unit.moduleFileExtensions,
  testRegex: '.*\\.e2e-spec\\.ts$',
  testEnvironment: 'node',
  transform: unit.transform,
  transformIgnorePatterns: unit.transformIgnorePatterns,
  // Creates the test database if needed and runs the migrations, once.
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  // Loads .env.test before each test file.
  setupFiles: ['<rootDir>/test/e2e/setup-env.ts'],
  testTimeout: 30000,
};

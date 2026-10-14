/**
 * Jest configuration for unit tests (`*.spec.ts` next to the code in src/).
 *
 * NestJS 12 packages are ES modules only. Jest on Node.js 22 cannot `require()`
 * them, so they are transpiled to CommonJS by test/esm-to-cjs.transformer.js.
 * Every other dependency is CommonJS and is loaded untouched.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': '<rootDir>/test/esm-to-cjs.transformer.js',
  },
  transformIgnorePatterns: ['/node_modules/(?!@nestjs/)'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
};

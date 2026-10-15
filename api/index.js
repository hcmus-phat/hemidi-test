/**
 * Entry of the Vercel function (docs/08 §4.1). vercel.json rewrites every
 * path to /api, so this function receives every request.
 *
 * It exports the handler of src/vercel.ts, from the bundle that
 * `npm run build:vercel` writes: tsc compiles src/ to dist/ (with the
 * decorator metadata Nest's dependency injection needs), then
 * scripts/bundle-vercel.js turns the ES-module-only @nestjs/* packages into
 * CommonJS, because Vercel runs functions without require(esm) (ADR-025).
 */
module.exports = require('../dist/vercel.bundle.js').default;

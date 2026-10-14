/**
 * Entry of the Vercel function (docs/08 §4.1). vercel.json rewrites every
 * path to /api, so this function receives every request.
 *
 * It exports the handler of src/vercel.ts as compiled to dist/ by
 * `nest build` (tsc). Nest's dependency injection needs the decorator
 * metadata that tsc emits and esbuild-based bundlers do not (ADR-025).
 */
module.exports = require('../dist/vercel').default;

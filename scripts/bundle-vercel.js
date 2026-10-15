/**
 * Bundles dist/vercel.js into dist/vercel.bundle.js, the code of the Vercel
 * function (docs/08 §4.1). Run by `npm run build:vercel` after `nest build`.
 *
 * Why: the @nestjs/* 12 packages are ES modules only, and dist/ is CommonJS.
 * Node 22 can require() an ES module, but Vercel starts functions with
 * --no-experimental-require-module, so `require('@nestjs/common')` throws
 * ERR_REQUIRE_ESM there. esbuild turns every package that is an ES module
 * into CommonJS inside the bundle. Packages that can be required as they
 * are (typeorm, pg, bullmq, ioredis, ...) stay external and load from
 * node_modules as usual, which keeps their runtime file lookups working.
 *
 * The input is the JavaScript that tsc emitted, so the decorator metadata
 * Nest needs for dependency injection is already in it (ADR-025).
 */
const esbuild = require('esbuild');
const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** `@scope/name/sub/path` -> `@scope/name`, `name/sub` -> `name`. */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The `type` of the package.json closest to `file`. */
function packageType(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).type;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
}

/**
 * Whether require(specifier) from `fromDir` would load an ES module, i.e.
 * fail on Vercel. A package whose exports have no CommonJS entry cannot be
 * resolved for require() at all: it is an ES module too.
 * Returns undefined when the package is not installed (an optional peer
 * dependency that Nest only loads when present).
 */
function isEsModule(specifier, fromDir) {
  let file;
  try {
    file = require.resolve(specifier, { paths: [fromDir] });
  } catch (error) {
    return error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? true : undefined;
  }
  if (file.endsWith('.mjs')) return true;
  if (file.endsWith('.cjs')) return false;
  return packageType(file) === 'module';
}

/** Package names bundled because they are ES modules, for the build log. */
const bundled = new Set();

const bundleEsModulesOnly = {
  name: 'bundle-es-modules-only',
  setup(build) {
    // Bare specifiers only: relative imports (our own dist/ files and the
    // files inside a bundled package) are always bundled.
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      const name = packageName(args.path.replace(/^node:/, ''));
      if (args.path.startsWith('node:') || builtinModules.includes(name)) {
        return { external: true };
      }
      if (isEsModule(args.path, args.resolveDir)) {
        bundled.add(name);
        return undefined;
      }
      return { external: true };
    });
  },
};

esbuild
  .build({
    entryPoints: [path.join(root, 'dist', 'vercel.js')],
    outfile: path.join(root, 'dist', 'vercel.bundle.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // Bundling may rename classes that share a name; Nest and TypeORM read
    // class names (logger contexts, repository tokens), so keep them.
    keepNames: true,
    // ES modules read import.meta.url, which CommonJS does not have.
    define: { 'import.meta.url': '__import_meta_url' },
    banner: {
      js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;",
    },
    plugins: [bundleEsModulesOnly],
    logLevel: 'warning',
  })
  .then(() => {
    console.log(
      `dist/vercel.bundle.js: bundled ${[...bundled].sort().join(', ')}`,
    );
  })
  .catch(() => {
    process.exitCode = 1;
  });

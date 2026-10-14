/**
 * Jest transformer that turns ES module packages from node_modules into CommonJS.
 *
 * NestJS 12 packages are published as ES modules only. Node.js >= 22.12 can
 * `require()` them natively, so the compiled app runs fine. Jest, however, loads
 * modules through its own CommonJS registry, which can only `require()` ES modules
 * on Node.js >= 24.9. To keep the tests running on Node.js 22, Jest transpiles
 * those packages (see `transformIgnorePatterns` in jest.config.js) with this file.
 *
 * It is only used by tests. Production code never goes through it.
 * Jest caches transformed files: run `npx jest --clearCache` after editing this file.
 */
const ts = require('typescript');

// ES modules rebuild CommonJS variables themselves, e.g.
// `const require = createRequire(import.meta.url)`. In CommonJS these names are
// already parameters of the module wrapper, so redeclaring them is a syntax
// error: the declarations are dropped and the built-in values are used.
const COMMONJS_VARIABLE_DECLARATION =
  /^[ \t]*(?:const|let|var)[ \t]+(?:require|__filename|__dirname)[ \t]*=.*$/gm;

module.exports = {
  process(sourceText, sourcePath) {
    const code = sourceText
      .replace(COMMONJS_VARIABLE_DECLARATION, '')
      // `import.meta` does not exist in CommonJS; build the same file URL.
      .replace(
        /\bimport\.meta\.url\b/g,
        "require('node:url').pathToFileURL(__filename).href",
      );

    const { outputText } = ts.transpileModule(code, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        allowJs: true,
        esModuleInterop: true,
      },
    });

    return { code: outputText };
  },
};

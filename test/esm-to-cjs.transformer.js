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
 */
const ts = require('typescript');

module.exports = {
  process(sourceText, sourcePath) {
    // `import.meta` does not exist in CommonJS. Packages only use it to build a
    // `require` function (`createRequire(import.meta.url)`), so the file URL is enough.
    const code = sourceText.replace(
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

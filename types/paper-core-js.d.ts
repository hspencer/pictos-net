/**
 * paper's own paper.d.ts declares the ambient module 'paper/dist/paper-core'
 * (no extension) with full types via `export =`. The sibling paper-core.d.ts
 * file (resolved when the extension is explicit, as svgBooleanOps.ts does for
 * Node ESM compatibility) is a one-line stub — `import './paper';` — with no
 * re-export, so TS sees an empty module for the '.js' specifier. This shim
 * gives 'paper/dist/paper-core.js' the same type shape as its extensionless
 * sibling instead of duplicating paper's large ambient declaration.
 */
declare module 'paper/dist/paper-core.js' {
    import paperCore = require('paper/dist/paper-core');
    export = paperCore;
}

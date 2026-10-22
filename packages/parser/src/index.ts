import { createRequire } from 'node:module';
import { configureWasm } from './core';

export * from './core';

// Node: grammars are files in node_modules/tree-sitter-wasms; the runtime is found next to web-tree-sitter itself.
const require_ = createRequire(import.meta.url);
configureWasm({ grammar: (lang) => require_.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`) });

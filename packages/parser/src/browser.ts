// Browser entry (the web app aliases `@codegraph/parser` to this file). Each .wasm is a bundler-emitted asset, and a
// grammar is only downloaded when a file of that language is parsed.
import runtime from 'web-tree-sitter/tree-sitter.wasm?url';
import javascript from 'tree-sitter-wasms/out/tree-sitter-javascript.wasm?url';
import python from 'tree-sitter-wasms/out/tree-sitter-python.wasm?url';
import tsx from 'tree-sitter-wasms/out/tree-sitter-tsx.wasm?url';
import typescript from 'tree-sitter-wasms/out/tree-sitter-typescript.wasm?url';
import { configureWasm, type LangId } from './core';

export * from './core';

const GRAMMARS: Record<LangId, string> = { javascript, python, tsx, typescript };
configureWasm({ runtime, grammar: (lang) => GRAMMARS[lang] });

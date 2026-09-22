import { createRequire } from 'node:module';
import { Language, Parser, type Node, type Tree } from 'web-tree-sitter';

export type { Node, Tree };
export type LangId = 'typescript' | 'tsx' | 'javascript' | 'python';

const EXT_TO_LANG: Record<string, LangId> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_TO_LANG);

export function langForPath(path: string): LangId | undefined {
  const i = path.lastIndexOf('.');
  return i < 0 ? undefined : EXT_TO_LANG[path.slice(i).toLowerCase()];
}

/** Coarse language family used by extractors (ts/tsx/js share one extractor). */
export function familyOf(lang: LangId): 'js' | 'python' {
  return lang === 'python' ? 'python' : 'js';
}

let initPromise: Promise<void> | undefined;
const parsers = new Map<LangId, Promise<Parser>>();
const require_ = createRequire(import.meta.url);

async function ensureInit() {
  initPromise ??= Parser.init();
  await initPromise;
}

function getParser(lang: LangId): Promise<Parser> {
  let p = parsers.get(lang);
  if (!p) {
    p = (async () => {
      await ensureInit();
      const wasm = require_.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`);
      const language = await Language.load(wasm);
      const parser = new Parser();
      parser.setLanguage(language);
      return parser;
    })();
    parsers.set(lang, p);
  }
  return p;
}

/** Parses source text. Caller should call `tree.delete()` when done to free WASM memory. */
export async function parse(lang: LangId, source: string): Promise<Tree> {
  const parser = await getParser(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`tree-sitter failed to parse ${lang} source`);
  return tree;
}

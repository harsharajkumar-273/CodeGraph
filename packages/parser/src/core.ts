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

/**
 * Where the WebAssembly files live. The core is environment-neutral; an entry point (`index.ts` for Node,
 * `browser.ts` for bundlers) says how to find them: a file path in Node, a URL in a browser.
 */
export interface WasmLocator {
  /** The tree-sitter runtime (`tree-sitter.wasm`); omit to use web-tree-sitter's default lookup. */
  runtime?: string;
  /** Path or URL of the grammar for a language. */
  grammar(lang: LangId): string;
}

let locator: WasmLocator | undefined;
export function configureWasm(l: WasmLocator) {
  locator = l;
}

let initPromise: Promise<void> | undefined;
const parsers = new Map<LangId, Promise<Parser>>();

async function ensureInit() {
  const runtime = locator?.runtime;
  initPromise ??= Parser.init(runtime ? { locateFile: () => runtime } : undefined);
  await initPromise;
}

function getParser(lang: LangId): Promise<Parser> {
  let p = parsers.get(lang);
  if (!p) {
    p = (async () => {
      if (!locator) throw new Error('@codegraph/parser: no WebAssembly locator configured (import the package entry point)');
      await ensureInit();
      const language = await Language.load(locator.grammar(lang));
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
  if (!tree.rootNode.hasError || (lang !== 'typescript' && lang !== 'tsx')) return tree;
  // Retry once with explicit separators between overloaded call signatures (see separateSignatures), and keep
  // whichever tree has fewer lines inside ERROR/missing nodes. Only lines' ends change, so positions stay valid.
  const retry = parser.parse(separateSignatures(source));
  if (!retry || errorLines(retry.rootNode) >= errorLines(tree.rootNode)) {
    retry?.delete();
    return tree;
  }
  tree.delete();
  return retry;
}

/**
 * tree-sitter-typescript reads
 *
 *     ): Response
 *     <T extends null>(data: T): Response
 *
 * (two call signatures of an interface, no `;` between them) as `Response<T extends …`, and in larger interfaces the
 * error swallows the whole file: every class and function in it disappears from the graph (Hono's context.ts,
 * Immer's types-external.ts). Appends `;` to the line before a line that starts with `<`, when that line (skipping
 * blank and comment lines) ends like a type. Line numbers are unchanged.
 */
export function separateSignatures(source: string): string {
  const lines = source.split('\n');
  const skip = (l: string) => /^\s*$/.test(l) || /^\s*(\/\/|\/\*|\*)/.test(l);
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*</.test(lines[i])) continue;
    let j = i - 1;
    while (j >= 0 && skip(lines[j])) j--;
    if (j >= 0 && /[\w)\]>'"]\s*$/.test(lines[j])) lines[j] += ';';
  }
  return lines.join('\n');
}

function errorLines(node: Node): number {
  if (node.type === 'ERROR' || node.isMissing) return node.endPosition.row - node.startPosition.row + 1;
  let n = 0;
  for (const c of node.children) if (c) n += errorLines(c);
  return n;
}

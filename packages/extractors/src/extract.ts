import { familyOf, langForPath, parse } from '@codegraph/parser';
import { extractGo } from './go';
import { extractJs } from './js';
import { extractPython } from './python';
import type { FileFacts } from './types';

/** Parse one file with Tree-sitter and extract its facts. Returns undefined for unsupported files. */
export async function extractFile(path: string, source: string): Promise<FileFacts | undefined> {
  const lang = langForPath(path);
  if (!lang) return undefined;
  const tree = await parse(lang, source);
  try {
    const family = familyOf(lang);
    const facts = family === 'python' ? extractPython(path, lang, tree.rootNode) : family === 'go' ? extractGo(path, lang, tree.rootNode) : extractJs(path, lang, tree.rootNode);
    facts.lineCount = source.split('\n').length;
    return facts;
  } finally {
    tree.delete();
  }
}

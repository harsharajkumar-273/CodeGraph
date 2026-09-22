import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { CodeGraph, Confidence, EdgeKind } from '@codegraph/core';

export const fixture = (name: string) => resolve(fileURLToPath(new URL('../../../fixtures/' + name, import.meta.url)));

export function label(g: CodeGraph, id: string) {
  const n = g.node(id)!;
  return n.kind === 'file' ? n.file! : n.kind === 'external' ? `ext:${n.name}` : `${n.file}#${n.qualifiedName}`;
}

/** Edge lookup by human labels: `src/app.ts#main` -> `src/math.ts#add`. */
export function edge(g: CodeGraph, kind: EdgeKind, from: string, to: string) {
  return g.edges(kind).find((e) => label(g, e.from) === from && label(g, e.to) === to);
}
export const conf = (g: CodeGraph, kind: EdgeKind, from: string, to: string): Confidence | undefined => edge(g, kind, from, to)?.confidence;

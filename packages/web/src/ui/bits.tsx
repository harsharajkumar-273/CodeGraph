import type { Confidence, GraphNode } from '@codegraph/core';

export const CONF_LABEL: Record<Confidence, string> = { resolved: 'resolved', probable: 'probable', ambiguous: 'ambiguous' };

const KIND_GLYPH: Record<string, string> = { function: 'ƒ', method: 'm', class: 'C', variable: 'x', file: '▤', folder: '▸', external: '↗' };

/** The little square that says what kind of thing a node is. */
export function KindBadge({ kind }: { kind: GraphNode['kind'] | 'folder' }) {
  return (
    <span className={`kind kind-${kind}`} title={kind} aria-label={kind}>
      {KIND_GLYPH[kind] ?? '·'}
    </span>
  );
}

/** A coloured dot for an edge's confidence. */
export function ConfDot({ c }: { c: Confidence }) {
  return <i className={`dot dot-${c}`} title={`${c} edge`} aria-label={`${c} edge`} />;
}

/** Stacked bar of resolved / probable / ambiguous counts. */
export function ConfidenceBar({ counts, height = 8 }: { counts: Record<Confidence, number>; height?: number }) {
  const total = counts.resolved + counts.probable + counts.ambiguous;
  if (!total) return null;
  return (
    <div className="confbar" style={{ height }} role="img" aria-label={`${counts.resolved} resolved, ${counts.probable} probable, ${counts.ambiguous} ambiguous`}>
      {(['resolved', 'probable', 'ambiguous'] as const).map((c) => (counts[c] ? <span key={c} className={`seg seg-${c}`} style={{ flexGrow: counts[c] }} title={`${counts[c]} ${c}`} /> : null))}
    </div>
  );
}

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

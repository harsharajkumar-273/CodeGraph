import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

export const sizeFor = (label: string, sub?: string) => ({
  width: Math.min(360, Math.max(150, Math.max(label.length * 8, (sub?.length ?? 0) * 6.6) + 64)),
  height: sub ? 58 : 44,
});

/** Layered layout (dagre), left-to-right or right-to-left. Mutates positions in place and returns the nodes. */
export function layout(nodes: Node[], edges: Edge[], rankdir: 'LR' | 'RL' = 'LR'): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 22, ranksep: 84, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: (n.width as number) ?? 160, height: (n.height as number) ?? 44 });
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const p = g.node(n.id);
    n.position = { x: p.x - p.width / 2, y: p.y - p.height / 2 };
  }
  return nodes;
}

/**
 * Ego layout for one selected node: what points at it in a column on its left, what it points at in a column on its
 * right. Unlike a layered layout this stays compact however the neighbours are connected to each other.
 */
export function egoLayout(nodes: Node[], focusId: string, leftIds: Set<string>): Node[] {
  const GAP_X = 120;
  const GAP_Y = 16;
  const w = (n: Node) => (n.width as number) ?? 160;
  const h = (n: Node) => (n.height as number) ?? 44;
  const focus = nodes.find((n) => n.id === focusId);
  if (!focus) return nodes;
  const left = nodes.filter((n) => n.id !== focusId && leftIds.has(n.id));
  const right = nodes.filter((n) => n.id !== focusId && !leftIds.has(n.id));
  const colWidth = (col: Node[]) => col.reduce((m, n) => Math.max(m, w(n)), 0);
  const leftW = colWidth(left);
  const x = { left: 0, focus: (left.length ? leftW + GAP_X : 0), right: 0 };
  x.right = x.focus + w(focus) + GAP_X;
  const stack = (col: Node[], colX: number, align: 'left' | 'right') => {
    const total = col.reduce((s, n) => s + h(n), 0) + GAP_Y * Math.max(0, col.length - 1);
    let y = -total / 2;
    for (const n of col) {
      n.position = { x: align === 'right' ? colX + colWidth(col) - w(n) : colX, y };
      y += h(n) + GAP_Y;
    }
  };
  stack(left, x.left, 'right');
  stack(right, x.right, 'left');
  focus.position = { x: x.focus, y: -h(focus) / 2 };
  return nodes;
}

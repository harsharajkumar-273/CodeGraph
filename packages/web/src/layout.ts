import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

export const sizeFor = (label: string, sub?: string) => ({
  width: Math.min(340, Math.max(130, Math.max(label.length * 7.4, (sub?.length ?? 0) * 6) + 36)),
  height: sub ? 54 : 40,
});

/** Left-to-right layered layout (dagre). Mutates positions in place and returns the nodes. */
export function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 90, marginx: 20, marginy: 20 });
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

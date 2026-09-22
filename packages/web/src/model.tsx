import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { CodeGraph, type Confidence, type GraphNode } from '@codegraph/core';
import { blastRadius, slice, variableLineage, type ImpactResult, type LineageResult, type SliceResult } from '@codegraph/analysis';
import { layout, sizeFor } from './layout';

export type View = 'folders' | 'files' | 'symbols';
export type Mode = 'slice' | 'impact';

export interface Params {
  view: View;
  mode: Mode;
  folderDepth: number;
  scope: string;
  focus: string | null;
  minConf: Confidence;
  radius: number;
}

export interface ViewModel {
  nodes: Node[];
  edges: Edge[];
  note?: string;
  impact?: ImpactResult;
  sliced?: SliceResult;
  lineage?: LineageResult;
}

export const COLORS = {
  bg: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  seed: '#1f6feb',
  caller: '#8957e5',
  callee: '#238636',
  d1: '#da3633',
  d2: '#d1642e',
  d3: '#9e6a03',
};

const depthColor = (d: number) => (d <= 1 ? COLORS.d1 : d === 2 ? COLORS.d2 : COLORS.d3);
const CONF_STYLE: Record<Confidence, { stroke: string; dash?: string }> = {
  resolved: { stroke: '#6e7681' },
  probable: { stroke: '#d29922', dash: '6 4' },
  ambiguous: { stroke: '#f85149', dash: '2 4' },
};

const baseStyle = (fill = COLORS.bg, border = COLORS.border, w = 1) => ({
  background: fill,
  color: COLORS.text,
  border: `${w}px solid ${border}`,
  borderRadius: 8,
  fontSize: 12,
  padding: 0,
});

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const folderKey = (file: string, depth: number) => {
  const d = dirOf(file);
  return d ? d.split('/').slice(0, depth).join('/') : '(root)';
};

function mkNode(id: string, title: string, sub: string | undefined, style: Node['style'], extra: Partial<Node> = {}): Node {
  const { width, height } = sizeFor(title, sub);
  return {
    id,
    position: { x: 0, y: 0 },
    width,
    height,
    data: {
      label: (
        <div style={{ padding: '6px 10px', lineHeight: 1.25, overflow: 'hidden' }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {sub && <div style={{ opacity: 0.6, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
        </div>
      ),
    },
    style: { ...style, width, height },
    ...extra,
  };
}

function mkEdge(id: string, s: string, t: string, conf: Confidence | 'import', label?: string, width = 1.4): Edge {
  const st = conf === 'import' ? { stroke: '#484f58' } : CONF_STYLE[conf];
  return {
    id,
    source: s,
    target: t,
    label,
    markerEnd: { type: MarkerType.ArrowClosed, color: st.stroke, width: 14, height: 14 },
    style: { stroke: st.stroke, strokeWidth: width, strokeDasharray: (st as { dash?: string }).dash },
    labelStyle: { fill: '#8b949e', fontSize: 10 },
    labelBgStyle: { fill: '#0d1117' },
  };
}

export function symbolTitle(n: GraphNode) {
  if (n.kind === 'file') return n.name;
  if (n.kind === 'class' || n.kind === 'variable') return n.qualifiedName ?? n.name;
  return `${n.qualifiedName ?? n.name}()`;
}

export function computeImpact(graph: CodeGraph, p: Params): ImpactResult | undefined {
  if (!p.focus || p.mode !== 'impact') return undefined;
  if (graph.node(p.focus)?.kind === 'variable') return undefined; // variables use dataflow lineage instead, see variableLineage()
  return blastRadius(graph, [p.focus], { maxDepth: p.radius + 3, minConfidence: p.minConf });
}

/** A variable's dataflow: what fed it (upstream, "caller"-colored) and what it feeds (downstream, "callee"-colored). */
function variableView(graph: CodeGraph, p: Params, focus: GraphNode): ViewModel {
  const res = variableLineage(graph, focus.id, { maxDepth: p.radius + 2 });
  const colorFor = new Map<string, { fill: string }>([[focus.id, { fill: COLORS.seed }]]);
  for (const u of res.upstream) colorFor.set(u.id, { fill: COLORS.caller });
  for (const d of res.downstream) colorFor.set(d.id, { fill: COLORS.callee });
  let ids = [...colorFor.keys()];
  let note: string | undefined;
  const CAP = 120;
  if (ids.length > CAP) {
    note = `Showing ${CAP} of ${ids.length} nodes.`;
    ids = ids.slice(0, CAP);
  } else if (!res.upstream.length && !res.downstream.length) {
    note = 'No tracked dataflow: this variable is a parameter, a literal, or only reads something not tracked yet (an import, a call result, a field).';
  }
  const set = new Set(ids);
  const nodes = ids.map((id) => {
    const n = graph.node(id)!;
    const c = colorFor.get(id)!;
    const isSeed = id === focus.id;
    return mkNode(id, symbolTitle(n), n.file ? `${n.file}${n.startLine ? ':' + n.startLine : ''}` : undefined, baseStyle(c.fill, isSeed ? '#79c0ff' : '#f0f6fc33', isSeed ? 2 : 1));
  });
  const edges = graph
    .edges('flows')
    .filter((e) => set.has(e.from) && set.has(e.to))
    .map((e) => mkEdge(`v:${e.from}>${e.to}`, e.from, e.to, e.confidence));
  return { nodes: layout(nodes, edges), edges, note, lineage: res };
}

export function buildView(graph: CodeGraph, p: Params, impact?: ImpactResult): ViewModel {
  if (p.view === 'folders') return foldersView(graph, p, impact);
  if (p.view === 'files') return filesView(graph, p, impact);
  return symbolsView(graph, p);
}

function impactedFileDepth(graph: CodeGraph, p: Params, impact?: ImpactResult) {
  const m = new Map<string, number>();
  if (!impact) return m;
  for (const f of impact.files) m.set(f.path, f.depth);
  const focusFile = p.focus ? graph.node(p.focus)?.file : undefined;
  if (focusFile) m.set(focusFile, 0);
  return m;
}

function foldersView(graph: CodeGraph, p: Params, impact?: ImpactResult): ViewModel {
  const files = graph.nodes('file');
  const counts = new Map<string, { files: number; syms: number }>();
  const fileFolder = new Map<string, string>();
  for (const f of files) {
    const k = folderKey(f.file!, p.folderDepth);
    fileFolder.set(f.id, k);
    const c = counts.get(k) ?? { files: 0, syms: 0 };
    c.files++;
    c.syms += graph.symbolsInFile(f.file!).length;
    counts.set(k, c);
  }
  const heat = new Map<string, number>();
  for (const [file, d] of impactedFileDepth(graph, p, impact)) {
    const k = folderKey(file, p.folderDepth);
    heat.set(k, Math.min(heat.get(k) ?? 99, d));
  }
  const nodes = [...counts].map(([k, c]) => {
    const d = heat.get(k);
    const style = d === undefined ? baseStyle() : baseStyle(d === 0 ? COLORS.seed : depthColor(d), '#f0f6fc55');
    return mkNode(`folder:${k}`, k, `${c.files} files · ${c.syms} symbols`, style);
  });
  const agg = new Map<string, number>();
  for (const e of graph.edges('imports')) {
    const a = fileFolder.get(e.from);
    const b = fileFolder.get(e.to);
    if (!a || !b || a === b) continue;
    agg.set(`${a}\u0000${b}`, (agg.get(`${a}\u0000${b}`) ?? 0) + 1);
  }
  const edges = [...agg].map(([k, n]) => {
    const [a, b] = k.split('\u0000');
    return mkEdge(`f:${k}`, `folder:${a}`, `folder:${b}`, 'import', String(n), Math.min(1 + Math.log2(n), 5));
  });
  return { nodes: layout(nodes, edges), edges, impact, note: 'Click a folder to drill into its files.' };
}

function filesView(graph: CodeGraph, p: Params, impact?: ImpactResult): ViewModel {
  const CAP = 260;
  let files = graph.nodes('file').filter((f) => !p.scope || f.file!.startsWith(p.scope + '/') || f.file === p.scope);
  let note: string | undefined;
  const deg = (id: string) => graph.incoming(id, ['imports']).length + graph.outgoing(id, ['imports']).length;
  if (files.length > CAP) {
    note = `Showing the ${CAP} most connected of ${files.length} files. Narrow the scope by drilling into a folder.`;
    files = [...files].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, CAP);
  }
  const ids = new Set(files.map((f) => f.id));
  const heat = impactedFileDepth(graph, p, impact);
  const nodes = files.map((f) => {
    const d = heat.get(f.file!);
    const sel = p.focus === f.id || (p.focus && graph.node(p.focus)?.file === f.file);
    let style = baseStyle(COLORS.bg, sel ? '#58a6ff' : COLORS.border, sel ? 2 : 1);
    if (d !== undefined) style = baseStyle(d === 0 ? COLORS.seed : depthColor(d), '#f0f6fc55');
    return mkNode(f.id, f.name, dirOf(f.file!) || undefined, style);
  });
  const edges = graph
    .edges('imports')
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => mkEdge(`i:${e.from}>${e.to}`, e.from, e.to, 'import'));
  return { nodes: layout(nodes, edges), edges, impact, note };
}

function symbolsView(graph: CodeGraph, p: Params): ViewModel {
  if (!p.focus || !graph.hasNode(p.focus)) {
    return { nodes: [], edges: [], note: 'Search for a function, class or file (or double-click a file) to see its call graph.' };
  }
  const focus = graph.node(p.focus)!;
  if (focus.kind === 'variable') return variableView(graph, p, focus);
  const seeds = focus.kind === 'file' ? graph.symbolsInFile(focus.file!).filter((s) => s.kind !== 'class' && s.kind !== 'variable').slice(0, 30).map((s) => s.id) : [p.focus];
  const colorFor = new Map<string, { fill: string; border?: string }>();
  let ids: string[] = [];
  let impact: ImpactResult | undefined;
  let sliced: SliceResult | undefined;
  if (p.mode === 'impact') {
    impact = blastRadius(graph, seeds, { maxDepth: p.radius + 2, minConfidence: p.minConf, includeImporters: false });
    for (const s of impact.seeds) colorFor.set(s, { fill: COLORS.seed });
    for (const i of impact.impacted) colorFor.set(i.id, { fill: depthColor(i.depth) });
    ids = [...colorFor.keys()];
  } else {
    sliced = slice(graph, seeds, { callersDepth: p.radius, calleesDepth: p.radius, minConfidence: p.minConf });
    for (const [id, role] of sliced.roles) colorFor.set(id, { fill: role === 'seed' ? COLORS.seed : role === 'caller' ? COLORS.caller : COLORS.callee });
    ids = [...colorFor.keys()];
  }
  let note: string | undefined;
  const CAP = 160;
  if (ids.length > CAP) {
    note = `Showing ${CAP} of ${ids.length} nodes — lower the radius or raise the minimum confidence.`;
    ids = ids.slice(0, CAP);
  }
  const set = new Set(ids);
  const nodes = ids.map((id) => {
    const n = graph.node(id)!;
    const c = colorFor.get(id)!;
    const isSeed = seeds.includes(id);
    return mkNode(id, symbolTitle(n), n.file ? `${n.file}${n.startLine ? ':' + n.startLine : ''}` : undefined, baseStyle(c.fill, isSeed ? '#79c0ff' : '#f0f6fc33', isSeed ? 2 : 1));
  });
  const edges = graph
    .edges(['calls', 'extends'])
    .filter((e) => set.has(e.from) && set.has(e.to))
    .map((e) => mkEdge(`c:${e.from}>${e.to}:${e.kind}`, e.from, e.to, e.confidence, e.kind === 'extends' ? 'extends' : undefined));
  return { nodes: layout(nodes, edges), edges, note, impact, sliced };
}

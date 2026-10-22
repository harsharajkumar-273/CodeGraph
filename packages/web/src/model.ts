import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { CodeGraph, fileId, type Confidence, type GraphNode } from '@codegraph/core';
import { blastRadius, isTestPath, slice, variableLineage, type ImpactResult, type LineageResult, type SliceResult } from '@codegraph/analysis';
import { egoLayout, layout, sizeFor } from './layout';

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
  /** Show every test function as its own node; by default they are folded into one node per test file. */
  showTests: boolean;
}

export interface ViewModel {
  nodes: Node[];
  edges: Edge[];
  note?: string;
  impact?: ImpactResult;
  sliced?: SliceResult;
  lineage?: LineageResult;
}

/** How a node is coloured: its role in the current analysis. The palette itself is in styles.css (`.tone-*`). */
export type Tone = 'neutral' | 'seed' | 'd1' | 'd2' | 'd3' | 'caller' | 'callee';
export type CgKind = GraphNode['kind'] | 'folder';

export interface CgNodeData extends Record<string, unknown> {
  title: string;
  sub?: string;
  kind: CgKind;
  tone: Tone;
  focused: boolean;
  /** Edges enter on the right and leave on the left (the blast-radius layout fans out to the right). */
  rtl?: boolean;
  /** What a click selects when the node stands for something else (a folded group of test functions stands for its file). */
  selectId?: string;
}

/** Shared with the legend. Keep in sync with the `--c-*` variables in styles.css. */
export const COLORS = {
  seed: '#5b8cff',
  caller: '#a78bfa',
  callee: '#2dd4bf',
  d1: '#ff6b6b',
  d2: '#ff9f5a',
  d3: '#f5c04a',
};

const depthTone = (d: number): Tone => (d <= 1 ? 'd1' : d === 2 ? 'd2' : 'd3');
const CONF_STYLE: Record<Confidence, { stroke: string; dash?: string }> = {
  resolved: { stroke: '#7d8aa0' },
  probable: { stroke: '#f5b942', dash: '7 5' },
  ambiguous: { stroke: '#ff6b6b', dash: '2 5' },
};

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const folderKey = (file: string, depth: number) => {
  const d = dirOf(file);
  return d ? d.split('/').slice(0, depth).join('/') : '(root)';
};

function mkNode(id: string, title: string, sub: string | undefined, kind: CgKind, tone: Tone, focused = false, extra: Partial<CgNodeData> = {}): Node<CgNodeData> {
  const { width, height } = sizeFor(title, sub);
  return { id, type: 'cg', position: { x: 0, y: 0 }, width, height, style: { width, height }, data: { title, sub, kind, tone, focused, ...extra } };
}

function mkEdge(id: string, s: string, t: string, conf: Confidence | 'import', opts: { label?: string; width?: number; hot?: boolean; smooth?: boolean } = {}): Edge {
  const st = conf === 'import' ? { stroke: '#4b566b', dash: undefined } : CONF_STYLE[conf];
  const width = opts.width ?? (opts.hot ? 2.2 : 1.4);
  return {
    id,
    source: s,
    target: t,
    ...(opts.smooth ? { type: 'smoothstep', pathOptions: { borderRadius: 14 } } : {}),
    label: opts.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: st.stroke, width: 16, height: 16 },
    style: { stroke: opts.hot ? '#9fb4d6' : st.stroke, strokeWidth: width, strokeDasharray: st.dash, opacity: opts.hot ? 1 : 0.8 },
    labelStyle: { fill: '#9aa4b2', fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: '#0b0e14' },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 6,
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

const where = (n: GraphNode) => (n.file ? `${n.file}${n.startLine ? ':' + n.startLine : ''}` : undefined);

/** A variable's dataflow: what fed it (upstream, "caller"-coloured) and what it feeds (downstream, "callee"-coloured). */
function variableView(graph: CodeGraph, p: Params, focus: GraphNode): ViewModel {
  const res = variableLineage(graph, focus.id, { maxDepth: p.radius + 2 });
  const tone = new Map<string, Tone>([[focus.id, 'seed']]);
  for (const u of res.upstream) tone.set(u.id, 'caller');
  for (const d of res.downstream) tone.set(d.id, 'callee');
  let ids = [...tone.keys()];
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
    return mkNode(id, symbolTitle(n), where(n), 'variable', tone.get(id)!, id === focus.id);
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

/** Folder keys for the folders view: the first `depth` path segments of every file. */
export function folderOf(file: string, depth: number) {
  return folderKey(file, depth);
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
    const tone: Tone = d === undefined ? 'neutral' : d === 0 ? 'seed' : depthTone(d);
    return mkNode(`folder:${k}`, k, `${c.files} file${c.files === 1 ? '' : 's'} · ${c.syms} symbols`, 'folder', tone);
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
    return mkEdge(`f:${k}`, `folder:${a}`, `folder:${b}`, 'import', { label: String(n), width: Math.min(1.2 + Math.log2(n), 5) });
  });
  return { nodes: layout(nodes, edges), edges, impact };
}

function filesView(graph: CodeGraph, p: Params, impact?: ImpactResult): ViewModel {
  const CAP = 120;
  let files = graph.nodes('file').filter((f) => !p.scope || f.file!.startsWith(p.scope + '/') || f.file === p.scope);
  let note: string | undefined;
  const deg = (id: string) => graph.incoming(id, ['imports']).length + graph.outgoing(id, ['imports']).length;
  if (files.length > CAP) {
    note = `Showing the ${CAP} most connected of ${files.length} files. Pick a folder to see the rest.`;
    files = [...files].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, CAP);
  }
  const focusFile = p.focus ? graph.node(p.focus)?.file : undefined;
  // Selecting a file narrows the view to its neighbourhood: what imports it and what it imports. An import graph of a
  // whole folder is too wide to read once something is selected; Escape clears the selection to get the folder back.
  const focusId = focusFile ? fileId(focusFile) : undefined;
  const near = new Set<string>(focusId ? [focusId] : []);
  if (focusId) {
    for (const e of graph.edges('imports')) {
      if (e.from === focusId) near.add(e.to);
      if (e.to === focusId) near.add(e.from);
    }
    // `near` also holds external packages (not files), so count the files themselves.
    const neighbours = graph.nodes('file').filter((f) => near.has(f.id));
    if (neighbours.length > 1) {
      files = neighbours;
      note = `${focusFile!.slice(focusFile!.lastIndexOf('/') + 1)} and the ${neighbours.length - 1} file${neighbours.length === 2 ? '' : 's'} that import it or that it imports. Press Esc to see the whole folder.`;
    }
  }
  const ids = new Set(files.map((f) => f.id));
  const heat = impactedFileDepth(graph, p, impact);
  const nodes = files.map((f) => {
    const d = heat.get(f.file!);
    const tone: Tone = d === undefined ? 'neutral' : d === 0 ? 'seed' : depthTone(d);
    return mkNode(f.id, f.name, dirOf(f.file!) || undefined, 'file', tone, p.focus === f.id || focusFile === f.file);
  });
  const ego = !!focusId && files.length > 1 && files.length < CAP && files.every((f) => near.has(f.id));
  const edges = graph
    .edges('imports')
    // In the neighbourhood view only the selected file's own edges are drawn; how its neighbours relate to each
    // other is a different question and would turn the view back into a web.
    .filter((e) => ids.has(e.from) && ids.has(e.to) && (!ego || e.from === focusId || e.to === focusId))
    .map((e) => mkEdge(`i:${e.from}>${e.to}`, e.from, e.to, 'import', { smooth: true, hot: ego }));
  if (ego) {
    const importers = new Set(graph.incoming(focusId!, ['imports']).map((e) => e.from));
    return { nodes: egoLayout(nodes, focusId!, importers), edges, impact, note };
  }
  return { nodes: layout(nodes, edges), edges, impact, note };
}

const TONE_PRIORITY: Tone[] = ['seed', 'd1', 'd2', 'd3', 'caller', 'callee', 'neutral'];
const CONF_RANK: Record<Confidence, number> = { resolved: 3, probable: 2, ambiguous: 1 };

function symbolsView(graph: CodeGraph, p: Params): ViewModel {
  if (!p.focus || !graph.hasNode(p.focus)) return { nodes: [], edges: [] };
  const focus = graph.node(p.focus)!;
  if (focus.kind === 'variable') return variableView(graph, p, focus);
  const seeds = focus.kind === 'file' ? graph.symbolsInFile(focus.file!).filter((s) => s.kind !== 'class' && s.kind !== 'variable').slice(0, 30).map((s) => s.id) : [p.focus];
  const seedSet = new Set(seeds);
  const tone = new Map<string, Tone>();
  let impact: ImpactResult | undefined;
  let sliced: SliceResult | undefined;
  const impactMode = p.mode === 'impact';
  if (impactMode) {
    impact = blastRadius(graph, seeds, { maxDepth: p.radius, minConfidence: p.minConf, includeImporters: false });
    for (const s of impact.seeds) tone.set(s, 'seed');
    for (const i of impact.impacted) tone.set(i.id, depthTone(i.depth));
  } else {
    sliced = slice(graph, seeds, { callersDepth: p.radius, calleesDepth: p.radius, minConfidence: p.minConf });
    for (const [id, role] of sliced.roles) tone.set(id, role === 'seed' ? 'seed' : role === 'caller' ? 'caller' : 'callee');
  }

  // Folding: test functions become one node per test file (so a hundred tests that exercise a function don't bury the
  // code), and when the whole picture would still be too big to read, everything else folds into one node per file too.
  const display = new Map<string, string>();
  const groups = new Map<string, { file: string; count: number; tone: Tone; noun: string }>();
  const fold = (id: string, gid: string, file: string, noun: string) => {
    display.set(id, gid);
    const t = tone.get(id)!;
    const g = groups.get(gid) ?? { file, count: 0, tone: t, noun };
    g.count++;
    if (TONE_PRIORITY.indexOf(t) < TONE_PRIORITY.indexOf(g.tone)) g.tone = t;
    groups.set(gid, g);
  };
  for (const id of tone.keys()) {
    const n = graph.node(id)!;
    if (!p.showTests && n.file && isTestPath(n.file) && !seedSet.has(id)) fold(id, `tests:${n.file}`, n.file, 'test function');
    else display.set(id, id);
  }
  const AUTO_FOLD = 50;
  let folded = false;
  if (new Set(display.values()).size > AUTO_FOLD) {
    folded = true;
    for (const id of [...display.keys()]) {
      const n = graph.node(id)!;
      if (display.get(id) === id && !seedSet.has(id) && n.file) fold(id, `group:${n.file}`, n.file, 'symbol');
    }
  }
  let shown = [...new Set(display.values())];
  let note: string | undefined = folded ? `${tone.size - seeds.length} symbols are involved, so they are folded into one node per file. Click a file to explore it.` : undefined;
  const CAP = 120;
  if (shown.length > CAP) {
    note = `Showing ${CAP} of ${shown.length} nodes. Lower the depth or raise the minimum confidence to see fewer.`;
    shown = shown.slice(0, CAP);
  }
  const set = new Set(shown);
  const nodes = shown.map((id) => {
    const g = groups.get(id);
    if (g) return mkNode(id, g.file.slice(g.file.lastIndexOf('/') + 1), `${g.count} ${g.noun}${g.count === 1 ? '' : 's'}`, 'file', g.tone, false, { rtl: impactMode, selectId: fileId(g.file) });
    const n = graph.node(id)!;
    return mkNode(id, symbolTitle(n), where(n), n.kind, tone.get(id)!, id === p.focus, { rtl: impactMode });
  });
  // Edges between displayed nodes; edges that land on the same folded node merge, keeping the strongest evidence.
  const merged = new Map<string, Edge & { rank: number }>();
  for (const e of graph.edges(['calls', 'extends'])) {
    const a = display.get(e.from);
    const b = display.get(e.to);
    if (!a || !b || a === b || !set.has(a) || !set.has(b)) continue;
    const key = `${a}>${b}:${e.kind}`;
    const rank = CONF_RANK[e.confidence];
    if (merged.get(key) && merged.get(key)!.rank >= rank) continue;
    merged.set(key, { ...mkEdge(`c:${key}`, a, b, e.confidence, { label: e.kind === 'extends' ? 'extends' : undefined, hot: seedSet.has(e.from) || seedSet.has(e.to) }), rank });
  }
  const edges = [...merged.values()].map(({ rank: _rank, ...edge }) => edge);
  return { nodes: layout(nodes, edges, impactMode ? 'RL' : 'LR'), edges, note, impact, sliced };
}

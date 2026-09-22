import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CodeGraph, type Confidence, type GraphJSON, type GraphNode } from '@codegraph/core';
import type { LineageResult } from '@codegraph/analysis';
import { importCycles } from '@codegraph/analysis';
import { COLORS, buildView, computeImpact, symbolTitle, type Params } from './model';

const INITIAL: Params = { view: 'files', mode: 'impact', folderDepth: 2, scope: '', focus: null, minConf: 'ambiguous', radius: 2 };

function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 250 }), 30);
    return () => clearTimeout(t);
  }, [signature, fitView]);
  return null;
}

export function App() {
  const [graph, setGraph] = useState<CodeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<Params>(INITIAL);
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Params>) => setP((cur) => ({ ...cur, ...patch }));

  const load = (json: GraphJSON) => {
    setGraph(CodeGraph.fromJSON(json));
    setP(INITIAL);
    setQuery('');
  };

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(load)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      load(JSON.parse(await f.text()));
      setError(null);
    } catch (e) {
      setError('Could not read that file: ' + (e as Error).message);
    }
  };

  const impact = useMemo(() => (graph ? computeImpact(graph, p) : undefined), [graph, p]);
  const vm = useMemo(() => (graph ? buildView(graph, p, impact) : null), [graph, p, impact]);
  const cycles = useMemo(() => (graph ? importCycles(graph) : []), [graph]);

  const results = useMemo(() => {
    if (!graph || !query.trim()) return [];
    const q = query.toLowerCase();
    return graph
      .nodes(['function', 'method', 'class', 'file'])
      .filter((n) => (n.kind === 'file' ? n.file! : `${n.qualifiedName} ${n.file}`).toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.exported) - Number(!!a.exported) || (a.qualifiedName ?? a.name).length - (b.qualifiedName ?? b.name).length)
      .slice(0, 40);
  }, [graph, query]);

  const focusNode = graph && p.focus ? graph.node(p.focus) : undefined;

  const onNodeClick = (_: unknown, node: Node) => {
    if (!graph) return;
    if (p.view === 'folders') return set({ view: 'files', scope: node.id.replace(/^folder:/, '') === '(root)' ? '' : node.id.replace(/^folder:/, '') });
    set({ focus: node.id });
  };
  const onNodeDoubleClick = (_: unknown, node: Node) => {
    if (p.view === 'files') set({ view: 'symbols', focus: node.id });
  };

  const stats = graph?.toJSON().stats as Record<string, number> | undefined;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="logo">◈</span> CodeGraph
        </div>

        {!graph && (
          <div className="card">
            <p>{error ? `No graph loaded (${error}).` : 'Loading graph…'}</p>
            <p className="muted">
              Start the API with <code>npm run cg -- serve &lt;repo&gt;</code>, or open a file produced by <code>npm run cg -- index &lt;repo&gt;</code>.
            </p>
            <button onClick={() => fileInput.current?.click()}>Open graph.json</button>
          </div>
        )}
        <input ref={fileInput} type="file" accept=".json" hidden onChange={(e) => onFile(e.target.files?.[0])} />

        {graph && (
          <>
            <div className="stats muted">
              {graph.nodes('file').length} files · {graph.nodes(['function', 'method', 'class']).length} symbols · {graph.edges('calls').length} calls
              {stats?.ms ? ` · indexed in ${stats.ms}ms` : ''}
              <button className="link" onClick={() => fileInput.current?.click()}>
                open…
              </button>
            </div>

            <div className="seg">
              {(['folders', 'files', 'symbols'] as const).map((v) => (
                <button key={v} className={p.view === v ? 'on' : ''} onClick={() => set({ view: v })}>
                  {v === 'folders' ? 'Folders' : v === 'files' ? 'Imports' : 'Calls'}
                </button>
              ))}
            </div>

            <input className="search" placeholder="Search function, class or file…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results.length > 0 && (
              <ul className="results">
                {results.map((n) => (
                  <li
                    key={n.id}
                    onClick={() => {
                      set({ focus: n.id, view: n.kind === 'file' ? p.view : 'symbols' });
                      setQuery('');
                    }}
                  >
                    <span className={`kind ${n.kind}`}>{n.kind === 'method' ? 'm' : n.kind[0]}</span>
                    <span className="rname">{n.kind === 'file' ? n.file : symbolTitle(n)}</span>
                    {n.kind !== 'file' && <span className="rfile">{n.file}</span>}
                  </li>
                ))}
              </ul>
            )}

            <div className="controls">
              <label>
                Analysis
                <select value={p.mode} onChange={(e) => set({ mode: e.target.value as Params['mode'] })}>
                  <option value="impact">Blast radius (who breaks)</option>
                  <option value="slice">Slice (callers + callees)</option>
                </select>
              </label>
              <label>
                Min confidence
                <select value={p.minConf} onChange={(e) => set({ minConf: e.target.value as Confidence })}>
                  <option value="ambiguous">all edges</option>
                  <option value="probable">probable +</option>
                  <option value="resolved">resolved only</option>
                </select>
              </label>
              <label>
                Radius {p.radius}
                <input type="range" min={1} max={5} value={p.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
              </label>
              {p.view === 'folders' && (
                <label>
                  Folder depth {p.folderDepth}
                  <input type="range" min={1} max={4} value={p.folderDepth} onChange={(e) => set({ folderDepth: Number(e.target.value) })} />
                </label>
              )}
              {p.view === 'files' && p.scope && (
                <div className="scope">
                  scope: <code>{p.scope}</code> <button className="link" onClick={() => set({ scope: '' })}>clear</button>
                </div>
              )}
            </div>

            {focusNode && <Details node={focusNode} graph={graph} impact={impact} lineage={vm?.lineage} onFocus={(id) => set({ focus: id, view: graph.node(id)?.kind === 'file' ? p.view : 'symbols' })} onClear={() => set({ focus: null })} />}

            {!focusNode && cycles.length > 0 && (
              <div className="card">
                <div className="h">Import cycles ({cycles.length})</div>
                {cycles.slice(0, 5).map((c, i) => (
                  <div key={i} className="muted small">
                    {c.length} files: {c.slice(0, 3).join(', ')}
                    {c.length > 3 ? '…' : ''}
                  </div>
                ))}
              </div>
            )}

            <Legend mode={p.mode} view={p.view} isVariable={focusNode?.kind === 'variable'} />
          </>
        )}
      </aside>

      <main className="canvas">
        {vm && (
          <ReactFlowProvider>
            <ReactFlow
              nodes={vm.nodes}
              edges={vm.edges}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              nodesDraggable
              nodesConnectable={false}
              minZoom={0.05}
              maxZoom={2}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#21262d" gap={24} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => String((n.style as { background?: string })?.background ?? '#30363d')} maskColor="#0d111788" />
              <FitOnChange signature={`${p.view}|${p.scope}|${p.folderDepth}|${vm.nodes.length}|${vm.nodes[0]?.id}`} />
            </ReactFlow>
            {vm.note && <div className="note">{vm.note}</div>}
          </ReactFlowProvider>
        )}
      </main>
    </div>
  );
}

function Details({ node, graph, impact, lineage, onFocus, onClear }: { node: GraphNode; graph: CodeGraph; impact?: ReturnType<typeof computeImpact>; lineage?: LineageResult; onFocus: (id: string) => void; onClear: () => void }) {
  const callers = graph.incoming(node.id, ['calls']);
  const callees = graph.outgoing(node.id, ['calls']);
  const syms = node.kind === 'file' ? graph.symbolsInFile(node.file!).filter((s) => s.kind !== 'class' || true) : [];
  const byConf = { resolved: 0, probable: 0, ambiguous: 0 } as Record<Confidence, number>;
  impact?.impacted.forEach((i) => byConf[i.confidence]++);
  return (
    <div className="card">
      <div className="h">
        {symbolTitle(node)} <button className="link" onClick={onClear}>clear</button>
      </div>
      <div className="muted small">
        {node.kind}
        {node.file ? ` · ${node.file}` : ''}
        {node.startLine ? `:${node.startLine}-${node.endLine}` : ''}
        {node.exported ? ' · exported' : ''}
      </div>
      {node.kind !== 'file' && node.kind !== 'variable' && (
        <div className="small">
          {callers.length} callers · {callees.length} callees
        </div>
      )}
      {lineage && (
        <div className="small">
          <div className="muted">{lineage.upstream.length} upstream source(s) · {lineage.downstream.length} downstream use(s)</div>
          {lineage.upstream.length > 0 && (
            <div>
              <span className="muted">fed by:</span>{' '}
              {lineage.upstream.map((u) => (
                <span key={u.id} className="chip" onClick={() => onFocus(u.id)}>{graph.node(u.id)!.name}</span>
              ))}
            </div>
          )}
          {lineage.downstream.length > 0 && (
            <div>
              <span className="muted">flows into:</span>{' '}
              {lineage.downstream.map((d) => (
                <span key={d.id} className="chip" onClick={() => onFocus(d.id)}>{graph.node(d.id)!.name}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {impact && (
        <div className="impact">
          <div className="big">{impact.impacted.length}</div>
          <div>
            symbols in {impact.files.length} files could be affected
            <div className="small">
              <span style={{ color: '#3fb950' }}>{byConf.resolved} resolved</span> · <span style={{ color: '#d29922' }}>{byConf.probable} probable</span> ·{' '}
              <span style={{ color: '#f85149' }}>{byConf.ambiguous} ambiguous</span>
            </div>
          </div>
        </div>
      )}
      {impact && impact.tests.length > 0 && (
        <div className="small">
          <div className="muted">Tests likely affected</div>
          {impact.tests.slice(0, 6).map((t) => (
            <div key={t} className="mono">{t}</div>
          ))}
          {impact.tests.length > 6 && <div className="muted">+{impact.tests.length - 6} more</div>}
          {impact.testsTransitive.length > 0 && <div className="muted">+{impact.testsTransitive.length} reach it only via 2–3 import hops</div>}
        </div>
      )}
      {syms.length > 0 && (
        <div className="symlist">
          <div className="muted small">Symbols</div>
          {syms.slice(0, 40).map((s) => (
            <div key={s.id} className="symrow" onClick={() => onFocus(s.id)}>
              <span className={`kind ${s.kind}`}>{s.kind === 'method' ? 'm' : s.kind[0]}</span> {symbolTitle(s)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ mode, view, isVariable }: { mode: Params['mode']; view: Params['view']; isVariable?: boolean }) {
  const items = isVariable
    ? [['this variable', COLORS.seed], ['upstream (fed it)', COLORS.caller], ['downstream (it feeds)', COLORS.callee]]
    : mode === 'impact' || view !== 'symbols'
      ? [['changed', COLORS.seed], ['depth 1', COLORS.d1], ['depth 2', COLORS.d2], ['depth 3+', COLORS.d3]]
      : [['target', COLORS.seed], ['caller', COLORS.caller], ['callee', COLORS.callee]];
  return (
    <div className="legend">
      {mode === 'slice' && view === 'symbols'
        ? items.map(([l, c]) => (
            <span key={l}><i style={{ background: c }} />{l}</span>
          ))
        : items.map(([l, c]) => (
            <span key={l}><i style={{ background: c }} />{l}</span>
          ))}
      <span className="edgeleg"><b style={{ borderTopStyle: 'solid' }} />resolved</span>
      <span className="edgeleg"><b style={{ borderTopStyle: 'dashed', borderColor: '#d29922' }} />probable</span>
      <span className="edgeleg"><b style={{ borderTopStyle: 'dotted', borderColor: '#f85149' }} />ambiguous</span>
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CONFIDENCE_RANK, type CodeGraph, type Confidence, type GraphEdge, type GraphNode } from '@codegraph/core';
import { blastRadius, type ImpactedNode, type LineageResult } from '@codegraph/analysis';
import { githubUrl } from '../links';
import { symbolTitle } from '../model';
import type { Session } from '../session';
import { ConfDot, ConfidenceBar, KindBadge, plural } from '../ui/bits';
import { IconCheck, IconCopy, IconExternal, IconX } from '../ui/icons';

type Tab = 'impact' | 'callers' | 'callees' | 'symbols' | 'imports' | 'flow' | 'code';

const TABS: Record<string, [Tab, string][]> = {
  symbol: [['impact', 'Blast radius'], ['callers', 'Callers'], ['callees', 'Calls'], ['code', 'Code']],
  file: [['impact', 'Blast radius'], ['symbols', 'Symbols'], ['imports', 'Imports'], ['code', 'Code']],
  variable: [['flow', 'Dataflow'], ['code', 'Code']],
};

const kindGroup = (n: GraphNode) => (n.kind === 'file' ? 'file' : n.kind === 'variable' ? 'variable' : 'symbol');
const MAX_CODE_LINES = 220;

const sortByConf = (edges: GraphEdge[], pick: (e: GraphEdge) => string, graph: CodeGraph) =>
  [...edges].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || (graph.node(pick(a))?.qualifiedName ?? '').localeCompare(graph.node(pick(b))?.qualifiedName ?? ''));

export function Inspector({
  session,
  node,
  minConf,
  lineage,
  onSelect,
  onShowCalls,
  onClose,
}: {
  session: Session;
  node: GraphNode;
  minConf: Confidence;
  lineage?: LineageResult;
  onSelect: (id: string) => void;
  onShowCalls: (id: string) => void;
  onClose: () => void;
}) {
  const { graph } = session;
  const group = kindGroup(node);
  const tabs = TABS[group];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const [copied, setCopied] = useState(false);
  // A new selection starts on that kind of thing's first tab.
  useEffect(() => setTab(TABS[kindGroup(node)][0][0]), [node.id]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  const impact = useMemo(() => (group === 'variable' ? undefined : blastRadius(graph, [node.id], { minConfidence: minConf })), [graph, node.id, minConf, group]);

  const loc = node.file ? (node.kind === 'file' ? node.file : `${node.file}:${node.startLine}${node.endLine && node.endLine !== node.startLine ? `–${node.endLine}` : ''}`) : '';
  const ghUrl = node.file ? githubUrl(session.origin, node.file, node.kind === 'file' ? undefined : node.startLine, node.endLine) : undefined;
  const callers = group === 'symbol' ? graph.incoming(node.id, ['calls', 'extends']).length : 0;
  const callees = group === 'symbol' ? graph.outgoing(node.id, ['calls', 'extends']).length : 0;

  return (
    <aside className="inspector" aria-label="Details">
      <div className="insp-head">
        <div className="insp-title">
          <KindBadge kind={node.kind} />
          <h2>{symbolTitle(node)}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" title="Close (Esc)">
            <IconX width={16} height={16} />
          </button>
        </div>
        {loc && (
          <div className="insp-loc">
            <code title={loc}>{loc}</code>
            <button type="button" className="icon-btn sm" onClick={() => navigator.clipboard?.writeText(loc).then(() => setCopied(true))} aria-label="Copy location" title="Copy location">
              {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
            </button>
            {ghUrl && (
              <a className="icon-btn sm" href={ghUrl} target="_blank" rel="noreferrer" aria-label="Open on GitHub" title="Open on GitHub">
                <IconExternal width={14} height={14} />
              </a>
            )}
          </div>
        )}
        <div className="insp-meta muted">
          {node.kind}
          {node.exported ? ' · exported' : ''}
          {group === 'symbol' ? ` · ${plural(callers, 'caller')} · calls ${callees}` : ''}
        </div>
        {group !== 'variable' && (
          <button type="button" className="primary sm" onClick={() => onShowCalls(node.id)}>
            Show on graph
          </button>
        )}
      </div>

      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'callers' && callers > 0 && <span className="tab-count">{callers}</span>}
            {id === 'callees' && callees > 0 && <span className="tab-count">{callees}</span>}
          </button>
        ))}
      </div>

      <div className="insp-body">
        {tab === 'impact' && impact && <ImpactTab graph={graph} node={node} impact={impact} files={impact.files.length} tests={impact.tests} testsTransitive={impact.testsTransitive.length} minConf={minConf} onSelect={onSelect} />}
        {tab === 'callers' && <EdgeList graph={graph} edges={sortByConf(graph.incoming(node.id, ['calls', 'extends']), (e) => e.from, graph)} side="from" empty="Nothing in this repository calls this." onSelect={onSelect} />}
        {tab === 'callees' && <EdgeList graph={graph} edges={sortByConf(graph.outgoing(node.id, ['calls', 'extends']), (e) => e.to, graph)} side="to" empty="This doesn't call anything else in the repository." onSelect={onSelect} />}
        {tab === 'symbols' && <SymbolsTab graph={graph} file={node.file!} onSelect={onSelect} />}
        {tab === 'imports' && <ImportsTab graph={graph} node={node} onSelect={onSelect} />}
        {tab === 'flow' && <FlowTab graph={graph} lineage={lineage} onSelect={onSelect} />}
        {tab === 'code' && <CodeTab session={session} node={node} />}
      </div>
    </aside>
  );
}

function Row({ node, sub, right, onClick }: { node: GraphNode; sub?: string; right?: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="row" onClick={onClick}>
        <KindBadge kind={node.kind} />
        <span className="row-main">
          <span className="row-name">{symbolTitle(node)}</span>
          <span className="row-sub">{sub ?? node.file}</span>
        </span>
        {right}
      </button>
    </li>
  );
}

function Group({ title, hint, children, count, limit = 7 }: { title: string; hint?: string; count: number; limit?: number; children: ReactNode[] }) {
  const [all, setAll] = useState(false);
  return (
    <section className="group">
      <h3>
        {title} <span className="tab-count">{count}</span>
      </h3>
      {hint && <p className="hint">{hint}</p>}
      <ul className="rows">{all ? children : children.slice(0, limit)}</ul>
      {children.length > limit && (
        <button type="button" className="link more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${children.length}`}
        </button>
      )}
    </section>
  );
}

function ImpactTab({ graph, node, impact, files, tests, testsTransitive, minConf, onSelect }: { graph: CodeGraph; node: GraphNode; impact: ReturnType<typeof blastRadius>; files: number; tests: string[]; testsTransitive: number; minConf: Confidence; onSelect: (id: string) => void }) {
  const counts: Record<Confidence, number> = { resolved: 0, probable: 0, ambiguous: 0 };
  for (const i of impact.impacted) counts[i.confidence]++;
  const n = impact.impacted.length;
  const byDepth = (pred: (d: number) => boolean) => impact.impacted.filter((i) => pred(i.depth));
  const row = (i: ImpactedNode) => {
    const x = graph.node(i.id);
    return x ? <Row key={i.id} node={x} right={<ConfDot c={i.confidence} />} onClick={() => onSelect(i.id)} /> : null;
  };
  const d1 = byDepth((d) => d === 1);
  const d2 = byDepth((d) => d === 2);
  const d3 = byDepth((d) => d >= 3);

  if (n === 0) {
    return (
      <div className="empty-state">
        <div className="hero">
          <span className="hero-num ok">0</span>
          <span className="hero-text">other symbols depend on this</span>
        </div>
        <p>
          Nothing in this repository calls {node.kind === 'file' ? 'code in this file' : 'it'}, so changing it can't break other code here. Public API, entry points and unused code all look like this.
        </p>
        {minConf !== 'ambiguous' && <p className="hint">Some edges are hidden: the “{minConf === 'probable' ? 'Probable +' : 'Resolved only'}” filter in the toolbar ignores weaker matches. Choose “All edges” to include guesses.</p>}
      </div>
    );
  }
  return (
    <>
      <div className="hero">
        <span className="hero-num">{n}</span>
        <span className="hero-text">
          {n === 1 ? 'symbol' : 'symbols'} in {plural(files, 'file')} could break if this changes
        </span>
      </div>
      <ConfidenceBar counts={counts} height={8} />
      <div className="conf-legend">
        {(['resolved', 'probable', 'ambiguous'] as const).map((c) => (
          <span key={c} className={counts[c] ? '' : 'dim'}>
            <ConfDot c={c} /> {counts[c]} {c}
          </span>
        ))}
      </div>
      <p className="hint">
        <b>Resolved</b> edges are proven through imports and scope. <b>Probable</b> and <b>ambiguous</b> ones are name matches, so check them before relying on them.
      </p>

      {d1.length > 0 && <Group title="Calls it directly" count={d1.length}>{d1.map(row)}</Group>}
      {d2.length > 0 && <Group title="Two hops away" count={d2.length}>{d2.map(row)}</Group>}
      {d3.length > 0 && <Group title="Three or more hops" count={d3.length}>{d3.map(row)}</Group>}

      {(tests.length > 0 || testsTransitive > 0) && (
        <section className="group">
          <h3>
            Tests to run <span className="tab-count">{tests.length}</span>
          </h3>
          {tests.length > 0 ? (
            <ul className="plain mono-list">
              {tests.slice(0, 8).map((t) => (
                <li key={t}>{t}</li>
              ))}
              {tests.length > 8 && <li className="muted">and {tests.length - 8} more</li>}
            </ul>
          ) : (
            <p className="hint">No test file touches this directly.</p>
          )}
          {testsTransitive > 0 && <p className="hint">{plural(testsTransitive, 'more test file')} reach it only through two or three imports.</p>}
        </section>
      )}
    </>
  );
}

function EdgeList({ graph, edges, side, empty, onSelect }: { graph: CodeGraph; edges: GraphEdge[]; side: 'from' | 'to'; empty: string; onSelect: (id: string) => void }) {
  if (!edges.length) return <p className="empty-line">{empty}</p>;
  return (
    <ul className="rows">
      {edges.map((e) => {
        const x = graph.node(e[side]);
        if (!x) return null;
        const at = side === 'from' && e.line ? `${x.file}:${e.line}` : undefined;
        return <Row key={`${e.from}>${e.to}:${e.kind}`} node={x} sub={at} right={<>{e.kind === 'extends' && <span className="pill">extends</span>}<ConfDot c={e.confidence} /></>} onClick={() => onSelect(x.id)} />;
      })}
    </ul>
  );
}

function SymbolsTab({ graph, file, onSelect }: { graph: CodeGraph; file: string; onSelect: (id: string) => void }) {
  const syms = graph.symbolsInFile(file).filter((s) => s.kind !== 'variable');
  if (!syms.length) return <p className="empty-line">No functions or classes were found in this file.</p>;
  return (
    <ul className="rows">
      {syms.map((s) => (
        <Row key={s.id} node={s} sub={`line ${s.startLine}${s.endLine && s.endLine !== s.startLine ? `–${s.endLine}` : ''}`} onClick={() => onSelect(s.id)} />
      ))}
    </ul>
  );
}

function ImportsTab({ graph, node, onSelect }: { graph: CodeGraph; node: GraphNode; onSelect: (id: string) => void }) {
  const out = graph.outgoing(node.id, ['imports']);
  const inn = graph.incoming(node.id, ['imports']);
  const internal = out.map((e) => graph.node(e.to)).filter((n): n is GraphNode => !!n && n.kind === 'file');
  const external = [...new Set(out.map((e) => graph.node(e.to)).filter((n): n is GraphNode => !!n && n.kind === 'external').map((n) => n.name))].sort();
  const importers = inn.map((e) => graph.node(e.from)).filter((n): n is GraphNode => !!n);
  return (
    <>
      <Group title="Imported by" count={importers.length} hint={importers.length ? undefined : 'No other file imports this one.'}>
        {importers.map((n) => <Row key={n.id} node={n} sub={n.file} onClick={() => onSelect(n.id)} />)}
      </Group>
      <Group title="Imports from this repository" count={internal.length}>
        {internal.map((n) => <Row key={n.id} node={n} sub={n.file} onClick={() => onSelect(n.id)} />)}
      </Group>
      {external.length > 0 && (
        <section className="group">
          <h3>
            External packages <span className="tab-count">{external.length}</span>
          </h3>
          <p className="chips">
            {external.map((x) => (
              <span key={x} className="chip">
                {x}
              </span>
            ))}
          </p>
        </section>
      )}
    </>
  );
}

function FlowTab({ graph, lineage, onSelect }: { graph: CodeGraph; lineage?: LineageResult; onSelect: (id: string) => void }) {
  if (!lineage || (!lineage.upstream.length && !lineage.downstream.length)) {
    return <p className="empty-line">No tracked dataflow: this variable is a parameter, a literal, or only reads something that isn't tracked yet (an import, a call result, a field).</p>;
  }
  const rows = (list: { id: string }[]) => list.map((h) => graph.node(h.id)).filter((n): n is GraphNode => !!n).map((n) => <Row key={n.id} node={n} sub={`${n.file}:${n.startLine}`} onClick={() => onSelect(n.id)} />);
  return (
    <>
      {lineage.upstream.length > 0 && <Group title="Fed by" count={lineage.upstream.length}>{rows(lineage.upstream)}</Group>}
      {lineage.downstream.length > 0 && <Group title="Flows into" count={lineage.downstream.length}>{rows(lineage.downstream)}</Group>}
    </>
  );
}

function CodeTab({ session, node }: { session: Session; node: GraphNode }) {
  const text = node.file ? session.files?.get(node.file) : undefined;
  if (!node.file) return <p className="empty-line">This node has no source location.</p>;
  if (text === undefined) return <p className="empty-line">Source isn't available for a graph opened from a file. Analyze the repository itself to read the code here.</p>;
  const lines = text.split('\n');
  const start = node.kind === 'file' ? 1 : node.startLine ?? 1;
  const end = Math.min(node.kind === 'file' ? lines.length : node.endLine ?? start, start + MAX_CODE_LINES - 1);
  const shown = lines.slice(start - 1, end);
  const width = String(end).length;
  return (
    <>
      <pre className="code" aria-label={`Source of ${node.name}`}>
        {shown.map((l, i) => (
          <div key={i} className="code-line">
            <span className="code-no" style={{ minWidth: `${width}ch` }}>
              {start + i}
            </span>
            <span className="code-text">{l || ' '}</span>
          </div>
        ))}
      </pre>
      {end < (node.kind === 'file' ? lines.length : node.endLine ?? end) && <p className="hint">Showing the first {MAX_CODE_LINES} lines.</p>}
    </>
  );
}

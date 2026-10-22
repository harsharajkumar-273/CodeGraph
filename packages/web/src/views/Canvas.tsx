import { Fragment, useEffect, type ReactNode } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Confidence } from '@codegraph/core';
import { COLORS, type CgNodeData, type Mode, type Params, type View, type ViewModel } from '../model';
import { KindBadge } from '../ui/bits';
import { IconChevron } from '../ui/icons';

function CgNode({ data }: NodeProps<Node<CgNodeData>>) {
  const into = data.rtl ? Position.Right : Position.Left;
  const out = data.rtl ? Position.Left : Position.Right;
  return (
    <div className={`cg-node tone-${data.tone}${data.focused ? ' focused' : ''}`}>
      <Handle type="target" position={into} className="cg-handle" isConnectable={false} />
      <KindBadge kind={data.kind} />
      <div className="cg-text">
        <div className="cg-title">{data.title}</div>
        {data.sub && <div className="cg-sub">{data.sub}</div>}
      </div>
      <Handle type="source" position={out} className="cg-handle" isConnectable={false} />
    </div>
  );
}
const nodeTypes = { cg: CgNode };

/**
 * Re-frames the graph when what it shows changes. A small graph is fitted whole. In a big one, fitting everything makes
 * the text unreadable, so the view settles on the selected node and its neighbours; the rest is a pan away.
 */
function FitOnChange({ signature, focusId, edges }: { signature: string; focusId: string | null; edges: { source: string; target: string }[] }) {
  const { fitView, getNodes } = useReactFlow();
  // The canvas also changes size (the inspector opening narrows it), and a view framed for the old size ends up clipped.
  const width = useStore((st) => Math.round(st.width / 20));
  useEffect(() => {
    const t = setTimeout(() => {
      const near = new Set<string>();
      if (focusId) {
        near.add(focusId);
        for (const e of edges) {
          if (e.source === focusId) near.add(e.target);
          if (e.target === focusId) near.add(e.source);
        }
      }
      if (getNodes().length > 14 && near.size > 1) fitView({ nodes: [...near].map((id) => ({ id })), padding: 0.3, maxZoom: 1, minZoom: 0.45, duration: 280 });
      else fitView({ padding: 0.18, maxZoom: 1.1, duration: 280 });
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width, fitView]);
  return null;
}

const TONE_COLOR: Record<string, string> = { neutral: '#2c364a', seed: COLORS.seed, caller: COLORS.caller, callee: COLORS.callee, d1: COLORS.d1, d2: COLORS.d2, d3: COLORS.d3 };

export interface Crumb {
  label: string;
  onClick?: () => void;
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, text, tip]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} title={tip} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, title }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; title?: string }) {
  return (
    <div className="stepper" title={title}>
      <span className="stepper-label">{label}</span>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <b>{value}</b>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function Legend({ params, isVariable }: { params: Params; isVariable: boolean }) {
  const showImpact = params.mode === 'impact' || params.view !== 'symbols';
  const items: [string, string][] = isVariable
    ? [['this variable', COLORS.seed], ['fed it', COLORS.caller], ['it feeds', COLORS.callee]]
    : showImpact
      ? [['changed', COLORS.seed], ['hit directly', COLORS.d1], ['2 hops', COLORS.d2], ['3+ hops', COLORS.d3]]
      : [['target', COLORS.seed], ['caller', COLORS.caller], ['callee', COLORS.callee]];
  return (
    <div className="legend" aria-label="Legend">
      {items.map(([l, c]) => (
        <span key={l}>
          <i style={{ background: c }} />
          {l}
        </span>
      ))}
      <span className="legend-sep" />
      <span title="Proven through imports and scope">
        <b className="line solid" />
        resolved
      </span>
      <span title="One plausible name match nearby">
        <b className="line dashed" />
        probable
      </span>
      <span title="Several candidates share the name">
        <b className="line dotted" />
        ambiguous
      </span>
    </div>
  );
}

const MIN_CONF: [Confidence, string, string][] = [
  ['ambiguous', 'All edges', 'Include name-only guesses'],
  ['probable', 'Probable +', 'Hide ambiguous edges'],
  ['resolved', 'Resolved only', 'Only edges proven through imports and scope'],
];

export function Canvas({
  vm,
  params,
  set,
  crumbs,
  isVariable,
  empty,
  onNodeClick,
  onNodeDoubleClick,
  children,
}: {
  vm: ViewModel;
  params: Params;
  set: (patch: Partial<Params>) => void;
  crumbs: Crumb[];
  isVariable: boolean;
  empty?: ReactNode;
  onNodeClick: (node: Node) => void;
  onNodeDoubleClick: (node: Node) => void;
  children?: ReactNode;
}) {
  const analyzing = params.view === 'symbols' || params.focus !== null;
  return (
    <div className="canvas">
      <div className="toolbar">
        <div className="toolbar-top">
          <nav className="crumbs" aria-label="Where you are">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <IconChevron className="crumb-sep" width={12} height={12} />}
                {c.onClick ? (
                  <button type="button" className="crumb" onClick={c.onClick}>
                    {c.label}
                  </button>
                ) : (
                  <span className="crumb current">{c.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
          <div className="tools">
            {params.view === 'folders' && <Stepper label="Folder depth" value={params.folderDepth} min={1} max={4} onChange={(folderDepth) => set({ folderDepth })} />}
            <Segmented<View>
              label="View"
              value={params.view}
              onChange={(view) => set({ view })}
              options={[
                ['folders', 'Folders', 'Architecture: how folders depend on each other'],
                ['files', 'Files', 'Which files import which'],
                ['symbols', 'Calls', 'Functions and what calls them'],
              ]}
            />
          </div>
        </div>
        {analyzing && (
          <div className="tools tools-row">
            {params.view === 'symbols' && (
              <Segmented<Mode>
                label="Analysis"
                value={params.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  ['impact', 'Blast radius', 'Everything that could break if this changes'],
                  ['slice', 'Callers & callees', 'What it calls and what calls it'],
                ]}
              />
            )}
            <label className="select">
              <span className="visually-hidden">Edge confidence</span>
              <select value={params.minConf} onChange={(e) => set({ minConf: e.target.value as Confidence })} title="Which edges to follow">
                {MIN_CONF.map(([v, t, tip]) => (
                  <option key={v} value={v} title={tip}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {params.view === 'symbols' && <Stepper label="Depth" value={params.radius} min={1} max={5} onChange={(radius) => set({ radius })} title="How many hops from the selected code to follow" />}
            {params.view === 'symbols' && (
              <label className="check" title="Fold the test functions in each test file into a single node">
                <input type="checkbox" checked={!params.showTests} onChange={(e) => set({ showTests: !e.target.checked })} />
                Group tests
              </label>
            )}
          </div>
        )}
      </div>

      <div className="flow">
        <ReactFlowProvider>
          <ReactFlow
            nodes={vm.nodes}
            edges={vm.edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => onNodeClick(n)}
            onNodeDoubleClick={(_, n) => onNodeDoubleClick(n)}
            nodesDraggable
            nodesConnectable={false}
            minZoom={0.05}
            maxZoom={2}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1a2030" gap={26} size={1.4} />
            <Controls showInteractive={false} position="bottom-right" />
            {vm.nodes.length > 40 && <MiniMap pannable zoomable position="bottom-right" style={{ marginBottom: 118, width: 150, height: 100 }} nodeColor={(n) => TONE_COLOR[(n.data as CgNodeData)?.tone] ?? '#2c364a'} maskColor="rgba(8,11,17,.72)" />}
            <FitOnChange signature={`${params.view}|${params.scope}|${params.folderDepth}|${params.mode}|${params.radius}|${params.minConf}|${params.showTests}|${vm.nodes.length}|${vm.nodes[0]?.id}|${params.focus}`} focusId={params.focus} edges={vm.edges} />
          </ReactFlow>
        </ReactFlowProvider>
        {vm.nodes.length === 0 && empty && <div className="empty">{empty}</div>}
        {vm.note && <div className="note">{vm.note}</div>}
        {vm.nodes.length > 0 && (params.view === 'symbols' || params.focus) && <Legend params={params} isVariable={isVariable} />}
        {children}
      </div>
    </div>
  );
}

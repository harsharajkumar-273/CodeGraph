import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { fileId, type CodeGraph } from '@codegraph/core';
import { buildView, computeImpact, folderOf, symbolTitle, type CgNodeData, type Params, type View } from '../model';
import type { Session } from '../session';
import { ConfidenceBar, KindBadge, plural } from '../ui/bits';
import { IconCheck, IconGithub, IconLogo, IconMenu, IconX } from '../ui/icons';
import { Canvas, type Crumb } from './Canvas';
import { Inspector } from './Inspector';
import { Sidebar } from './Sidebar';

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A folder depth that gives a readable architecture map: enough boxes to be informative, not so many it's a hairball. */
function pickFolderDepth(graph: CodeGraph) {
  const files = graph.nodes('file');
  let best = 1;
  for (let d = 1; d <= 3; d++) {
    const n = new Set(files.map((f) => folderOf(f.file!, d))).size;
    if (n > 30) break;
    best = d;
    if (n >= 8) break;
  }
  return best;
}

function initialParams(graph: CodeGraph): Params {
  const folderDepth = pickFolderDepth(graph);
  const folders = new Set(graph.nodes('file').map((f) => folderOf(f.file!, folderDepth))).size;
  return { view: folders >= 3 ? 'folders' : 'files', mode: 'impact', folderDepth, scope: '', focus: null, minConf: 'probable', radius: 2, showTests: false };
}

export function Workspace({ session, shareUrl, onHome }: { session: Session; shareUrl?: string; onHome: () => void }) {
  const { graph, overview } = session;
  const [p, setP] = useState<Params>(() => initialParams(graph));
  const [sideOpen, setSideOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const set = useCallback((patch: Partial<Params>) => setP((cur) => ({ ...cur, ...patch })), []);

  const select = useCallback(
    (id: string) => {
      const n = graph.node(id);
      if (!n) return;
      setSideOpen(false);
      setP((cur) => {
        if (n.kind !== 'file') return { ...cur, focus: id, view: 'symbols' };
        const inScope = !cur.scope || n.file!.startsWith(cur.scope + '/');
        return { ...cur, focus: id, view: cur.view === 'symbols' ? 'symbols' : 'files', scope: inScope && cur.view === 'files' ? cur.scope : dirOf(n.file!) };
      });
    },
    [graph],
  );
  const openFolder = useCallback((path: string) => setP((cur) => ({ ...cur, view: 'files', scope: path === '(root)' ? '' : path, focus: null })), []);
  const home = useCallback(() => setP(initialParams(graph)), [graph]);

  const impact = useMemo(() => computeImpact(graph, p), [graph, p]);
  const vm = useMemo(() => buildView(graph, p, impact), [graph, p, impact]);
  const focusNode = p.focus ? graph.node(p.focus) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
        setSideOpen(true);
      } else if (e.key === 'Escape' && !typing) {
        setP((cur) => (cur.focus ? { ...cur, focus: null } : cur));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNodeClick = (n: Node) => {
    if (p.view === 'folders') openFolder(n.id.replace(/^folder:/, ''));
    else select((n.data as CgNodeData).selectId ?? n.id);
  };
  const onNodeDoubleClick = (n: Node) => {
    if (p.view === 'files') set({ view: 'symbols', focus: n.id });
  };

  const crumbs = useMemo<Crumb[]>(() => {
    const out: Crumb[] = [{ label: session.label, onClick: p.scope || p.focus || p.view !== 'folders' ? home : undefined }];
    if (p.scope) {
      const parts = p.scope.split('/');
      parts.forEach((part, i) => out.push({ label: part, onClick: () => openFolder(parts.slice(0, i + 1).join('/')) }));
    }
    if (focusNode) {
      if (focusNode.kind !== 'file' && focusNode.file && !out.some((c) => c.label === baseOf(focusNode.file!))) {
        out.push({ label: baseOf(focusNode.file), onClick: () => select(fileId(focusNode.file!)) });
      }
      out.push({ label: symbolTitle(focusNode) });
    }
    const last = out[out.length - 1];
    if (last.onClick && !focusNode) out[out.length - 1] = { label: last.label };
    return out;
  }, [session.label, p.scope, p.focus, p.view, focusNode, home, openFolder, select]);

  const emptyCalls = (
    <div className="empty-card">
      <h3>Pick something to trace</h3>
      <p>The Calls view follows one function, class or file through the code. Choose one from the list, search for it, or start with the code that is riskiest to change.</p>
      {overview.mostCalled.length > 0 && (
        <ul className="rows">
          {overview.mostCalled.slice(0, 4).map(({ node, callers }) => (
            <li key={node.id}>
              <button type="button" className="row" onClick={() => select(node.id)}>
                <KindBadge kind={node.kind} />
                <span className="row-main">
                  <span className="row-name">{symbolTitle(node)}</span>
                  <span className="row-sub">{node.file}</span>
                </span>
                <span className="pill">{callers} callers</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const total = overview.conf.resolved + overview.conf.probable + overview.conf.ambiguous;
  const github = session.origin.kind === 'github' ? session.origin : null;

  return (
    <div className={`workspace${sideOpen ? ' side-open' : ''}${focusNode ? ' has-inspector' : ''}`}>
      <header className="ws-head">
        <button type="button" className="icon-btn only-narrow" aria-label="Menu" onClick={() => setSideOpen((o) => !o)}>
          <IconMenu width={18} height={18} />
        </button>
        <button type="button" className="brand brand-btn" onClick={onHome} title="Analyze another repository">
          <IconLogo width={20} height={20} className="brand-logo" />
          <span>CodeGraph</span>
        </button>
        <span className="sep" />
        <div className="repo-chip">
          {github ? <IconGithub width={15} height={15} /> : null}
          <strong title={session.label}>{session.label}</strong>
          {session.detail && <span className="muted">{session.detail}</span>}
        </div>
        <div className="stats">
          <span>
            <b>{overview.files.toLocaleString()}</b> files
          </span>
          <span>
            <b>{overview.symbols.toLocaleString()}</b> symbols
          </span>
          <span>
            <b>{overview.calls.toLocaleString()}</b> calls
          </span>
        </div>
        {total > 0 && (
          <div className="confmix" title={`${overview.conf.resolved} resolved · ${overview.conf.probable} probable · ${overview.conf.ambiguous} ambiguous call edges`}>
            <ConfidenceBar counts={overview.conf} height={6} />
            <span>{Math.round((overview.conf.resolved / total) * 100)}% of calls proven</span>
          </div>
        )}
        <span className="spacer" />
        {shareUrl && (
          <button
            type="button"
            className="ghost sm"
            onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => (setLinkCopied(true), setTimeout(() => setLinkCopied(false), 1500)))}
            title="Copy a link that opens this analysis"
          >
            {linkCopied ? (
              <>
                <IconCheck width={14} height={14} /> Copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
        )}
        <button type="button" className="ghost sm" onClick={onHome}>
          Analyze another
        </button>
      </header>

      {session.notes.length > 0 && notesOpen && (
        <div className="notes-bar" role="status">
          <span>{session.notes.join(' ')}</span>
          <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => setNotesOpen(false)}>
            <IconX width={14} height={14} />
          </button>
        </div>
      )}

      <div className="ws-body">
        <Sidebar session={session} focusId={p.focus} scope={p.scope} onSelect={select} onFolder={openFolder} searchRef={searchRef} />
        <div className="scrim" onClick={() => setSideOpen(false)} />
        <Canvas
          vm={vm}
          params={p}
          set={set}
          crumbs={crumbs}
          isVariable={focusNode?.kind === 'variable'}
          empty={p.view === 'symbols' ? emptyCalls : <p className="empty-line">Nothing to show here.</p>}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
        >
          {p.view === 'folders' && !focusNode && vm.nodes.length > 0 && <div className="hint-card">Click a folder to open it. Search or pick from “Riskiest to change” to see a blast radius.</div>}
        </Canvas>
        {focusNode && (
          <Inspector
            session={session}
            node={focusNode}
            minConf={p.minConf}
            lineage={vm.lineage}
            onSelect={select}
            onShowCalls={(id) => set({ view: 'symbols' as View, focus: id })}
            onClose={() => set({ focus: null })}
          />
        )}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {focusNode ? `Selected ${symbolTitle(focusNode)}` : `${plural(vm.nodes.length, 'node')} shown`}
      </span>
    </div>
  );
}

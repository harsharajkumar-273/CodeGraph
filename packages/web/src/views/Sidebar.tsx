import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CodeGraph, GraphNode } from '@codegraph/core';
import { symbolTitle } from '../model';
import type { Session } from '../session';
import { KindBadge, plural } from '../ui/bits';
import { IconChevron, IconFile, IconFolder, IconSearch } from '../ui/icons';

type Tab = 'overview' | 'files';

function searchGraph(graph: CodeGraph, query: string): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return graph
    .nodes(['function', 'method', 'class', 'file'])
    .filter((n) => (n.kind === 'file' ? n.file! : `${n.qualifiedName} ${n.file}`).toLowerCase().includes(q))
    .sort((a, b) => Number(!!b.exported) - Number(!!a.exported) || (a.qualifiedName ?? a.name).length - (b.qualifiedName ?? b.name).length)
    .slice(0, 30);
}

interface TreeDir {
  name: string;
  path: string;
  dirs: Map<string, TreeDir>;
  files: GraphNode[];
  count: number;
}

function buildTree(graph: CodeGraph): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: new Map(), files: [], count: 0 };
  for (const f of graph.nodes('file')) {
    const parts = f.file!.split('/');
    let cur = root;
    cur.count++;
    for (const part of parts.slice(0, -1)) {
      const path = cur.path ? `${cur.path}/${part}` : part;
      let next = cur.dirs.get(part);
      if (!next) cur.dirs.set(part, (next = { name: part, path, dirs: new Map(), files: [], count: 0 }));
      next.count++;
      cur = next;
    }
    cur.files.push(f);
  }
  return root;
}

export function Sidebar({
  session,
  focusId,
  scope,
  onSelect,
  onFolder,
  searchRef,
}: {
  session: Session;
  focusId: string | null;
  scope: string;
  onSelect: (id: string) => void;
  onFolder: (path: string) => void;
  searchRef: RefObject<HTMLInputElement>;
}) {
  const { graph } = session;
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchGraph(graph, query), [graph, query]);
  useEffect(() => setActive(0), [query]);

  const pick = (id: string) => {
    onSelect(id);
    setQuery('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length) (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)));
    else if (e.key === 'ArrowUp' && results.length) (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === 'Enter' && results[active]) pick(results[active].id);
    else if (e.key === 'Escape') (setQuery(''), e.currentTarget.blur());
  };

  return (
    <aside className="side" aria-label="Explore">
      <div className="search-wrap">
        <IconSearch className="search-icon" />
        <input ref={searchRef} className="search" placeholder="Search functions, classes, files" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} spellCheck={false} />
        {!query && <kbd className="search-key">/</kbd>}
        {query && (
          <ul className="results" role="listbox">
            {results.length === 0 && <li className="results-empty">Nothing matches “{query}”</li>}
            {results.map((n, i) => (
              <li key={n.id} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), pick(n.id))}>
                <KindBadge kind={n.kind} />
                <span className="r-name">{n.kind === 'file' ? n.file : symbolTitle(n)}</span>
                {n.kind !== 'file' && <span className="r-sub">{n.file}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
          Files
        </button>
      </div>

      <div className="side-body">
        {tab === 'overview' ? <OverviewPanel session={session} onSelect={onSelect} /> : <FileTree graph={graph} focusId={focusId} scope={scope} onSelect={onSelect} onFolder={onFolder} />}
      </div>
    </aside>
  );
}

function OverviewPanel({ session, onSelect }: { session: Session; onSelect: (id: string) => void }) {
  const o = session.overview;
  const totalFiles = o.languages.reduce((n, l) => n + l.files, 0) || 1;
  return (
    <div className="overview">
      {o.mostCalled.length > 0 && (
        <section>
          <h3>Riskiest to change</h3>
          <p className="hint">The most-called code. Pick one to see what would break.</p>
          <ul className="rows">
            {o.mostCalled.map(({ node, callers }) => (
              <li key={node.id}>
                <button type="button" className="row" onClick={() => onSelect(node.id)}>
                  <KindBadge kind={node.kind} />
                  <span className="row-main">
                    <span className="row-name">{symbolTitle(node)}</span>
                    <span className="row-sub">{node.file}</span>
                  </span>
                  <span className="pill" title={`${callers} distinct callers`}>
                    {callers}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.hubs.length > 0 && (
        <section>
          <h3>Most imported files</h3>
          <ul className="rows">
            {o.hubs.map(({ node, importedBy }) => (
              <li key={node.id}>
                <button type="button" className="row" onClick={() => onSelect(node.id)}>
                  <KindBadge kind="file" />
                  <span className="row-main">
                    <span className="row-name">{node.name}</span>
                    <span className="row-sub">{node.file}</span>
                  </span>
                  <span className="pill" title={`imported by ${importedBy} files`}>
                    {importedBy}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.cycles.length > 0 && (
        <section>
          <h3>Import cycles</h3>
          <ul className="plain">
            {o.cycles.slice(0, 4).map((c, i) => (
              <li key={i} title={c.join('\n')}>
                <b>{plural(c.length, 'file')}</b> depend on each other
                <span className="row-sub">{c.slice(0, 3).join(', ')}{c.length > 3 ? ', …' : ''}</span>
              </li>
            ))}
            {o.cycles.length > 4 && <li className="muted">and {o.cycles.length - 4} more</li>}
          </ul>
        </section>
      )}

      <section>
        <h3>Languages</h3>
        <div className="langbar" role="img" aria-label={o.languages.map((l) => `${l.name} ${l.files} files`).join(', ')}>
          {o.languages.map((l, i) => (
            <span key={l.name} className={`lang lang-${i}`} style={{ flexGrow: l.files }} title={`${l.name}: ${plural(l.files, 'file')}`} />
          ))}
        </div>
        <ul className="langs">
          {o.languages.map((l, i) => (
            <li key={l.name}>
              <i className={`lang lang-${i}`} /> {l.name} <span className="muted">{Math.round((l.files / totalFiles) * 100)}%</span>
            </li>
          ))}
        </ul>
        {o.testFiles > 0 && <p className="hint">{plural(o.testFiles, 'test file')} recognised, used to say which tests a change could affect.</p>}
      </section>
    </div>
  );
}

function FileTree({ graph, focusId, scope, onSelect, onFolder }: { graph: CodeGraph; focusId: string | null; scope: string; onSelect: (id: string) => void; onFolder: (path: string) => void }) {
  const tree = useMemo(() => buildTree(graph), [graph]);
  const focusFile = focusId ? graph.node(focusId)?.file : undefined;
  const [open, setOpen] = useState<Set<string>>(() => new Set([...tree.dirs.keys()].slice(0, 1)));

  // Keep the selected file visible: open every folder above it.
  useEffect(() => {
    const target = focusFile ?? scope;
    if (!target) return;
    const parts = target.split('/');
    setOpen((cur) => {
      const next = new Set(cur);
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
  }, [focusFile, scope]);

  const toggle = (path: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const renderDir = (dir: TreeDir, depth: number) => {
    const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {dirs.map((d) => {
          const isOpen = open.has(d.path);
          return (
            <div key={d.path}>
              <button
                type="button"
                className={`tree-row${scope === d.path ? ' on' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                aria-expanded={isOpen}
                onClick={() => {
                  toggle(d.path);
                  onFolder(d.path);
                }}
              >
                <IconChevron className={`tree-chev${isOpen ? ' open' : ''}`} width={12} height={12} />
                <IconFolder width={14} height={14} className="tree-ico" />
                <span className="tree-name">{d.name}</span>
                <span className="tree-count">{d.count}</span>
              </button>
              {isOpen && renderDir(d, depth + 1)}
            </div>
          );
        })}
        {files.map((f) => (
          <button key={f.id} type="button" className={`tree-row file${focusFile === f.file ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 14 + 18 }} onClick={() => onSelect(f.id)}>
            <IconFile width={14} height={14} className="tree-ico" />
            <span className="tree-name">{f.name}</span>
          </button>
        ))}
      </>
    );
  };
  return <div className="tree">{renderDir(tree, 0)}</div>;
}

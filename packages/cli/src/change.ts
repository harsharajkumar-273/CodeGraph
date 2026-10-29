// One analysis of "this version of the code, against that one", shared by the pull request comment (the versions are two
// commits, the changed lines come from git) and by an agent asking about an edit it has not written yet (the versions are the
// checkout and the checkout with the proposed file contents laid over it, the changed lines come from diffLines).
import type { CodeGraph, Confidence, GraphNode } from '@codegraph/core';
import { indexFiles } from '@codegraph/extractors';
import {
  blastRadius, changedNodes, changedSignatures, isTestPath, removedButStillCalled, removedPublicApi,
  type CallSite, type FileChange, type ImpactResult,
} from '@codegraph/analysis';
import type { BaseComparison, MarkdownOptions } from './report';

type Trace = NonNullable<NonNullable<Parameters<typeof indexFiles>[3]>['trace']>;

/** An indexed version of the code, with what a comparison needs besides the graph: which calls resolved to nothing, and where each function is called. */
export interface VersionIndex {
  graph: CodeGraph;
  /** Per caller (`file#name`, or `file` for top-level code): call sites that resolved to nothing, as `name -> lines`. */
  unresolved: Map<string, Map<string, number[]>>;
  /** Per function (`file#name`): the calls that resolved to it, with how many arguments each passes. */
  sites: Map<string, CallSite[]>;
  files?: number;
}

/** A trace callback that fills the two maps of a `VersionIndex`. */
export function collectCalls(unresolved: VersionIndex['unresolved'], sites?: VersionIndex['sites']): Trace {
  return (t) => {
    if (t.call.kind === 'ref') return;
    const caller = t.call.caller ? `${t.file}#${t.call.caller}` : t.file;
    if (!t.targets.length) {
      const m = unresolved.get(caller) ?? new Map<string, number[]>();
      m.set(t.call.callee, [...(m.get(t.call.callee) ?? []), t.call.line]);
      unresolved.set(caller, m);
      return;
    }
    if (!sites) return;
    for (const target of t.targets) {
      const k = `${target.file}#${target.qname}`;
      const list = sites.get(k) ?? [];
      list.push({ caller, file: t.file, line: t.call.line, argc: t.call.argc });
      sites.set(k, list);
    }
  };
}

/** Indexes in-memory files as a version (nothing is read from or written to disk). */
export async function indexVersion(files: Map<string, string> | Record<string, string>, configs: Map<string, string> | Record<string, string>, root = '.'): Promise<VersionIndex> {
  const unresolved: VersionIndex['unresolved'] = new Map();
  const sites: VersionIndex['sites'] = new Map();
  const { graph, stats } = await indexFiles(files, configs, root, { trace: collectCalls(unresolved, sites) });
  return { graph, unresolved, sites, files: stats.files };
}

/** What the change did to the code it started from: removals still called, changed signatures, public API removed. */
export function compareVersions(base: VersionIndex, head: VersionIndex): BaseComparison {
  const symbols = (g: CodeGraph) => g.nodes(['function', 'method', 'class']);
  return {
    dangling: removedButStillCalled(base.graph, head.graph, head.unresolved, base.unresolved),
    signatures: changedSignatures(base.graph, head.graph, head.sites),
    removedApi: removedPublicApi(base.graph, head.graph),
    baseSymbols: new Set(symbols(base.graph).map((n) => `${n.file}#${n.qualifiedName}`)),
    baseNames: new Set(symbols(base.graph).map((n) => `${n.kind}:${n.qualifiedName ?? n.name}`)),
  };
}

export interface ChangeInput {
  head: VersionIndex;
  /** The version before the change. Without it there is no comparison: no removal or signature findings. */
  base?: VersionIndex;
  /** The changed lines, per file. */
  changes: FileChange[];
  minConfidence?: Confidence;
  maxDepth?: number;
  jsRunner?: 'vitest' | 'jest';
}

export interface ChangeAnalysis {
  res: ImpactResult;
  comparison?: BaseComparison;
  /** What the comment generator needs besides the graph and the impact. */
  options: MarkdownOptions;
  /** Symbols the change adds, and files it edits or deletes. */
  created: GraphNode[];
  unmapped: string[];
  /** Nothing in the change touches an indexed symbol and nothing was found: there is nothing to say. */
  empty: boolean;
}

/** The changed symbols, what the comparison found, and the blast radius of the edits that were not additions. */
export function analyzeChange(i: ChangeInput): ChangeAnalysis {
  const graph = i.head.graph;
  const changed = changedNodes(graph, i.changes);
  let { nodes, created } = changed;
  const comparison = i.base ? compareVersions(i.base, i.head) : undefined;
  if (comparison?.baseSymbols) {
    // A hunk that edits one function and adds another looks like a single edit; the base version says which symbols are new.
    const isFresh = (n: GraphNode) => ['function', 'method', 'class'].includes(n.kind) && !comparison.baseSymbols!.has(`${n.file}#${n.qualifiedName}`);
    created = [...created, ...nodes.filter(isFresh)];
    nodes = nodes.filter((n) => !isFresh(n));
  }
  // A function that only moved to another file is not new public API.
  const wasThere = (n: GraphNode) => !!comparison?.baseNames?.has(`${n.kind}:${n.qualifiedName ?? n.name}`);
  const options: MarkdownOptions = {
    changedFiles: new Set(i.changes.filter((c) => !c.deleted).map((c) => c.file)),
    created: created.length,
    createdPublic: created.filter((n) => n.exported && !n.name.startsWith('_') && !isTestPath(n.file ?? '') && !wasThere(n)).map((n) => `${n.file}#${n.qualifiedName}`),
    deletedFiles: i.changes.filter((c) => c.deleted).map((c) => c.file),
    comparison,
    jsRunner: i.jsRunner,
  };
  const res = blastRadius(graph, nodes.map((n) => n.id), { maxDepth: i.maxDepth, minConfidence: i.minConfidence ?? 'probable', expandFiles: false });
  const anyFinding = !!comparison && (comparison.dangling.length > 0 || comparison.signatures.length > 0 || comparison.removedApi.length > 0);
  const empty = !nodes.length && !created.length && !anyFinding && !options.deletedFiles!.length;
  return { res, comparison, options, created, unmapped: changed.unmapped, empty };
}

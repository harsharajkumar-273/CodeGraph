"""Independent ground truth for Python call edges: asks Jedi (not CodeGraph, not a human or an LLM labeler) which
definition every call site binds to. One JSON line per call site, same format and verdicts as ts-oracle.mts.

    python scripts/eval/py-oracle.py <repo-dir> <graph.json> <out.jsonl>     (pip install jedi==0.19.2)

Empty Jedi's bundled third-party stubs first (keep `jedi/third_party/typeshed/third_party` as an empty directory; Jedi
crashes if it is missing): they include old stubs for
packages such as flask, which make Jedi answer "external stub" for the repo's own code.

Only `f()` and `a.b.f()` calls are considered (the shapes CodeGraph extracts). Verdicts:
  internal  resolves to a function/method/class defined in this repo that has a graph node (`target`)
  nosym     resolves to repo code with no graph node (a lambda or a value bound at runtime, `f = make_f()`)
  external  resolves outside the repo (stdlib, builtins, site-packages) -> any internal edge is wrong
  unknown   Jedi cannot resolve it (untyped parameter, dynamic attribute) -> excluded from scoring
"""
import ast
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import jedi

SKIP = {'.git', '.codegraph', 'node_modules', 'build', 'dist', '.venv', 'venv', '.tox', '__pycache__'}
ROOT = ''
NODES = {}  # rel file -> {start line: "file#qualifiedName"}
BY_QNAME = {}  # rel file -> {qualifiedName: "file#qualifiedName"}


def py_files(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP]
        for f in files:
            if f.endswith('.py'):
                yield os.path.join(d, f)


def in_repo(path):
    if not path:
        return False
    rel = os.path.relpath(str(path), ROOT)
    return not rel.startswith('..') and not set(rel.split(os.sep)) & SKIP


def classify(defs):
    targets, verdicts, at = [], set(), None
    for d in defs:
        if d.in_builtin_module() or not in_repo(d.module_path):
            verdicts.add('external')
            at = at or str(d.module_path or d.module_name)
            continue
        rel = os.path.relpath(str(d.module_path), ROOT).replace(os.sep, '/')
        at = at or f'{rel}:{d.line}'
        if d.type in ('function', 'class'):
            node = NODES.get(rel, {}).get(d.line)
            if not node and d.full_name and d.module_name and d.full_name.startswith(d.module_name + '.'):
                # `@overload` stubs: Jedi points at the first stub, the graph node is the implementation.
                node = BY_QNAME.get(rel, {}).get(d.full_name[len(d.module_name) + 1:])
            if node:
                targets.append(node)
                if d.type == 'class':
                    targets.append(node + '.__init__')  # `Foo()` is correct when it points at the class or its __init__
                verdicts.add('internal')
            else:
                verdicts.add('nosym')
        elif d.type in ('instance', 'statement'):
            verdicts.add('nosym')
    if 'internal' in verdicts:
        return {'verdict': 'internal', 'target': targets[0], 'alts': targets, 'at': at}
    if verdicts == {'external'}:
        return {'verdict': 'external', 'at': at}
    if 'nosym' in verdicts:
        return {'verdict': 'nosym', 'at': at}
    return {'verdict': 'unknown'}


def run_file(path):
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    try:
        src = open(path, encoding='utf-8').read()
        tree = ast.parse(src)
    except (SyntaxError, UnicodeDecodeError, ValueError):
        return []
    project = jedi.Project(ROOT, added_sys_path=[ROOT, os.path.join(ROOT, 'src')], smart_sys_path=True)
    script = jedi.Script(src, path=path, project=project)
    rows = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if isinstance(fn, ast.Name):
            name, line, col = fn.id, fn.lineno, fn.col_offset
        elif isinstance(fn, ast.Attribute):
            name, line, col = fn.attr, fn.end_lineno, fn.end_col_offset - len(fn.attr)
        else:
            continue
        try:
            defs = script.goto(line, col, follow_imports=True)
            if defs and all(d.type in ('instance', 'statement') for d in defs):
                defs = script.infer(line, col) or defs  # `f = g; f()`: the value, not the assignment
            row = classify(defs) if defs else {'verdict': 'unknown'}
        except Exception:  # Jedi raises on some exotic syntax; the site is then simply not scored
            row = {'verdict': 'unknown'}
        rows.append({'file': rel, 'line': node.lineno, 'callee': name, 'isNew': False, **row})
    return rows


def init(root, nodes):
    global ROOT, NODES, BY_QNAME
    ROOT, NODES = root, nodes
    BY_QNAME = {f: {v.split('#', 1)[1]: v for v in by_line.values()} for f, by_line in nodes.items()}


def main():
    root, graph_path, out = os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3]
    graph = json.load(open(graph_path))
    nodes = {}
    for n in graph['nodes']:
        if n.get('file') and n['kind'] in ('function', 'method', 'class'):
            nodes.setdefault(n['file'], {})[n['startLine']] = f"{n['file']}#{n['qualifiedName']}"
    files = sorted(py_files(root))
    with ProcessPoolExecutor(initializer=init, initargs=(root, nodes)) as pool:
        rows = [r for rs in pool.map(run_file, files, chunksize=4) for r in rs]
    with open(out, 'w') as f:
        f.write('\n'.join(json.dumps(r) for r in rows))
    counts = {}
    for r in rows:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    print(f'{out}: {len(rows)} call sites', counts)


if __name__ == '__main__':
    main()

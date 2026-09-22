import type { Node } from '@codegraph/parser';
import { kids, named } from './util';
import type { CallFact, FileFacts, ImportBinding, SymbolFact, VarFact } from './types';

interface Ctx {
  caller: string | null;
  cls: string | null;
}

const line = (n: Node) => n.startPosition.row + 1;

function chain(n: Node | null | undefined): string | null {
  if (!n) return null;
  switch (n.type) {
    case 'identifier':
      return n.text;
    case 'attribute': {
      const o = chain(n.childForFieldName('object'));
      const a = n.childForFieldName('attribute');
      return o && a ? `${o}.${a.text}` : null;
    }
    case 'call': {
      // super().foo() => receiver "super"
      const f = n.childForFieldName('function');
      return f?.type === 'identifier' && f.text === 'super' ? 'super' : null;
    }
    default:
      return null;
  }
}

/** `Foo`, `mod.Foo`, `"Foo"`, `Optional[Foo]` => class name, else null. */
function annType(n: Node | null | undefined): string | null {
  if (!n) return null;
  const t = n.type === 'type' ? named(n)[0] : n;
  if (!t) return null;
  if (t.type === 'identifier' || t.type === 'attribute') return chain(t);
  if (t.type === 'string') return t.text.replace(/^['"]|['"]$/g, '').match(/^[\w.]+$/)?.[0] ?? null;
  if (t.type === 'subscript') {
    const v = chain(t.childForFieldName('value'));
    if (v === 'Optional' || v === 'typing.Optional') return annType(named(t).find((c) => c.id !== t.childForFieldName('value')?.id));
  }
  return null;
}

export function extractPython(path: string, lang: string, root: Node): FileFacts {
  const facts: FileFacts = { path, lang, family: 'python', symbols: [], imports: [], exports: [], calls: [], types: [], vars: [] };
  const declared = new Set<string>();

  const addSymbol = (s: SymbolFact) => {
    if (declared.has(s.qname)) return;
    declared.add(s.qname);
    facts.symbols.push(s);
    // top-level symbols form the module's public namespace
    if (!s.className && !s.qname.includes('.')) facts.exports.push({ name: s.name, local: s.qname });
  };

  function visitChildren(node: Node, ctx: Ctx) {
    for (const c of named(node)) visit(c, ctx);
  }

  const pushVar = (v: VarFact) => facts.vars.push(v);

  /** Identifiers read by an expression: RHS of `=`, a `for`'s iterable, a default value. */
  function collectReads(node: Node | null | undefined, out: string[] = []): string[] {
    if (!node) return out;
    switch (node.type) {
      case 'identifier':
        out.push(node.text);
        return out;
      case 'attribute':
        // `a.b.c`: only the base `a` is a variable read.
        collectReads(node.childForFieldName('object'), out);
        return out;
      case 'keyword_argument':
        collectReads(node.childForFieldName('value'), out);
        return out;
      case 'string':
      case 'integer':
      case 'float':
      case 'true':
      case 'false':
      case 'none':
      case 'comment':
        return out;
      default:
        for (const c of named(node)) collectReads(c, out);
        return out;
    }
  }

  /** Simple (non-destructured) parameter bindings, tracked as `param` variable definitions. */
  function declareParamVars(fn: Node, scope: string) {
    for (const p of named(fn.childForFieldName('parameters'))) {
      if (p.type === 'identifier') {
        pushVar({ scope, name: p.text, kind: 'param', line: line(p), reads: [] });
      } else if (p.type === 'typed_parameter' || p.type === 'list_splat_pattern' || p.type === 'dictionary_splat_pattern') {
        const id = named(p).find((c) => c.type === 'identifier');
        if (id) pushVar({ scope, name: id.text, kind: 'param', line: line(p), reads: [] });
      } else if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
        const nm = p.childForFieldName('name');
        if (nm?.type === 'identifier') pushVar({ scope, name: nm.text, kind: 'param', line: line(p), reads: collectReads(p.childForFieldName('value')) });
      }
      // tuple/list destructuring params are not tracked yet (stage 1 limitation).
    }
  }

  function declareFunction(node: Node, ctx: Ctx) {
    const nm = node.childForFieldName('name');
    if (!nm) return;
    const isMethod = !!ctx.cls && ctx.caller === ctx.cls;
    const qname = ctx.caller ? `${ctx.caller}.${nm.text}` : nm.text;
    addSymbol({
      name: nm.text,
      qname,
      kind: isMethod ? 'method' : 'function',
      startLine: line(node),
      endLine: node.endPosition.row + 1,
      className: isMethod ? (ctx.cls ?? undefined) : undefined,
    });
    for (const prm of named(node.childForFieldName('parameters'))) {
      if (prm.type !== 'typed_parameter' && prm.type !== 'typed_default_parameter') continue;
      const pn = prm.type === 'typed_parameter' ? named(prm).find((c) => c.type === 'identifier') : prm.childForFieldName('name');
      const t = annType(prm.childForFieldName('type'));
      if (pn && t) facts.types.push({ scope: qname, name: pn.text, type: t });
    }
    declareParamVars(node, qname);
    // parameters (defaults) and body run with the function as caller; `self` stays valid for nested closures.
    const inner: Ctx = { caller: qname, cls: isMethod ? ctx.cls : ctx.cls };
    for (const c of named(node)) if (c.id !== nm.id) visit(c, inner);
  }

  function declareClass(node: Node, ctx: Ctx) {
    const nm = node.childForFieldName('name');
    if (!nm) return;
    const qname = ctx.caller ? `${ctx.caller}.${nm.text}` : nm.text;
    const bases: string[] = [];
    const sup = node.childForFieldName('superclasses');
    if (sup) {
      for (const c of named(sup)) {
        const b = chain(c);
        if (b) bases.push(b);
      }
    }
    addSymbol({ name: nm.text, qname, kind: 'class', startLine: line(node), endLine: node.endPosition.row + 1, bases });
    const body = node.childForFieldName('body');
    if (body) for (const c of named(body)) visit(c, { caller: qname, cls: qname });
  }

  function handleImport(node: Node) {
    const bindings: ImportBinding[] = [];
    for (const c of named(node)) {
      if (c.type === 'dotted_name') {
        facts.imports.push({ specifier: c.text, bindings: [{ local: c.text, imported: '*' }], line: line(node) });
      } else if (c.type === 'aliased_import') {
        const nm = c.childForFieldName('name');
        const al = c.childForFieldName('alias');
        if (nm) facts.imports.push({ specifier: nm.text, bindings: [{ local: (al ?? nm).text, imported: '*' }], line: line(node) });
      }
    }
    void bindings;
  }

  function handleFrom(node: Node) {
    const mod = node.childForFieldName('module_name');
    if (!mod) return;
    let level = 0;
    let specifier = '';
    if (mod.type === 'relative_import') {
      const prefix = named(mod).find((c) => c.type === 'import_prefix');
      level = prefix ? prefix.text.length : 0;
      const dn = named(mod).find((c) => c.type === 'dotted_name');
      specifier = dn ? dn.text : '';
    } else {
      specifier = mod.text;
    }
    const bindings: ImportBinding[] = [];
    let star = false;
    for (const c of named(node)) {
      if (c.id === mod.id) continue;
      if (c.type === 'wildcard_import') star = true;
      else if (c.type === 'dotted_name') bindings.push({ local: c.text, imported: c.text });
      else if (c.type === 'aliased_import') {
        const nm = c.childForFieldName('name');
        const al = c.childForFieldName('alias');
        if (nm) bindings.push({ local: (al ?? nm).text, imported: nm.text });
      }
    }
    facts.imports.push({ specifier, bindings, line: line(node), level, star });
  }

  function push(c: Omit<CallFact, 'caller'>, ctx: Ctx) {
    facts.calls.push({ caller: ctx.caller, ...c });
  }

  function handleCall(node: Node, ctx: Ctx) {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    if (fn) {
      if (fn.type === 'identifier') {
        push({ callee: fn.text, kind: 'plain', line: line(node) }, ctx);
      } else if (fn.type === 'attribute') {
        const obj = chain(fn.childForFieldName('object'));
        const attr = fn.childForFieldName('attribute');
        if (attr) {
          if (obj === 'self' || obj === 'cls' || obj === 'super') push({ callee: attr.text, receiver: obj, kind: 'this', line: line(node) }, ctx);
          else push({ callee: attr.text, receiver: obj ?? undefined, kind: 'member', line: line(node) }, ctx);
        }
      }
    }
    if (args) {
      for (const a of named(args)) {
        if (a.type === 'identifier') push({ callee: a.text, kind: 'ref', line: line(a) }, ctx);
      }
    }
  }

  function visit(node: Node, ctx: Ctx) {
    switch (node.type) {
      case 'import_statement':
        handleImport(node);
        return;
      case 'import_from_statement':
        handleFrom(node);
        return;
      case 'function_definition':
        declareFunction(node, ctx);
        return;
      case 'class_definition':
        declareClass(node, ctx);
        return;
      case 'decorated_definition': {
        for (const c of named(node)) {
          if (c.type === 'decorator') {
            const expr = named(c)[0];
            if (expr?.type === 'identifier') push({ callee: expr.text, kind: 'ref', line: line(c) }, ctx);
            else if (expr) visit(expr, ctx);
          } else visit(c, ctx);
        }
        return;
      }
      case 'call':
        handleCall(node, ctx);
        visitChildren(node, ctx);
        return;
      case 'assignment': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const ln = chain(left);
        if (ln) {
          const t = annType(node.childForFieldName('type')) ?? (right?.type === 'call' ? chain(right.childForFieldName('function')) : null);
          if (t) {
            const isAttr = ln.startsWith('self.') || ln.startsWith('cls.');
            if (isAttr && ctx.cls) facts.types.push({ scope: `class:${ctx.cls}`, name: ln, type: t });
            else if (!isAttr) facts.types.push({ scope: ctx.caller, name: ln, type: t });
          }
          if (!ln.includes('.')) pushVar({ scope: ctx.caller, name: ln, kind: 'assign', line: line(node), reads: collectReads(right) });
        }
        visitChildren(node, ctx);
        return;
      }
      case 'augmented_assignment': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const ln = chain(left);
        if (ln && !ln.includes('.')) {
          const reads = collectReads(right);
          if (!reads.includes(ln)) reads.push(ln);
          pushVar({ scope: ctx.caller, name: ln, kind: 'aug', line: line(node), reads });
        }
        visitChildren(node, ctx);
        return;
      }
      case 'for_statement': {
        const left = node.childForFieldName('left');
        if (left?.type === 'identifier') {
          pushVar({ scope: ctx.caller, name: left.text, kind: 'loop', line: line(node), reads: collectReads(node.childForFieldName('right')) });
        }
        visitChildren(node, ctx);
        return;
      }
      default:
        visitChildren(node, ctx);
    }
  }

  visit(root, { caller: null, cls: null });
  return facts;
}

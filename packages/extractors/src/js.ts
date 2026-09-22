import type { Node } from '@codegraph/parser';
import { kids, named } from './util';
import type { CallFact, ExportFact, FileFacts, ImportBinding, ImportFact, SymbolFact, VarFact } from './types';

interface Ctx {
  caller: string | null;
  cls: string | null;
}

const FUNC_VALUE = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
const SKIP = new Set([
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'ambient_declaration',
  'comment',
  'import_require_clause',
]);

const line = (n: Node) => n.startPosition.row + 1;

function strLit(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'string') return n.text.slice(1, -1);
  if (n.type === 'template_string' && !n.text.includes('${')) return n.text.slice(1, -1);
  return null;
}

/** identifier / this / a.b.c => dotted string, otherwise null. */
function chain(n: Node | null | undefined): string | null {
  if (!n) return null;
  switch (n.type) {
    case 'identifier':
    case 'this':
    case 'super':
    case 'property_identifier':
    case 'type_identifier':
      return n.text;
    case 'nested_identifier':
      return n.text;
    case 'member_expression': {
      const o = chain(n.childForFieldName('object'));
      const p = n.childForFieldName('property');
      return o && p ? `${o}.${p.text}` : null;
    }
    case 'non_null_expression':
    case 'parenthesized_expression':
      return chain(named(n)[0]);
    default:
      return null;
  }
}

/** `Foo`, `Foo<T>`, `ns.Foo`, `Foo | null` => the class name; anything else => null. */
function typeName(n: Node | null | undefined): string | null {
  if (!n) return null;
  switch (n.type) {
    case 'type_annotation':
    case 'parenthesized_type':
      return typeName(named(n)[0]);
    case 'type_identifier':
    case 'nested_type_identifier':
      return n.text;
    case 'generic_type':
      return typeName(n.childForFieldName('name'));
    case 'union_type': {
      const names = named(n).map(typeName).filter((x): x is string => !!x);
      return names.length === 1 ? names[0] : null;
    }
    default:
      return null;
  }
}

export function extractJs(path: string, lang: string, root: Node): FileFacts {
  const facts: FileFacts = { path, lang, family: 'js', symbols: [], imports: [], exports: [], calls: [], types: [], vars: [] };
  const declared = new Set<string>();

  const addSymbol = (s: SymbolFact) => {
    if (declared.has(s.qname)) return;
    declared.add(s.qname);
    facts.symbols.push(s);
  };
  const addExport = (e: ExportFact) => {
    facts.exports = facts.exports.filter((x) => x.name !== e.name);
    facts.exports.push(e);
  };
  const qual = (ctx: Ctx, name: string) => (ctx.caller ? `${ctx.caller}.${name}` : name);
  const pushVar = (v: VarFact) => facts.vars.push(v);

  /** Identifiers read by an expression: the RHS of an assignment, a loop's iterable, a param default. */
  function collectReads(node: Node | null | undefined, out: string[] = []): string[] {
    if (!node) return out;
    switch (node.type) {
      case 'identifier':
        out.push(node.text);
        return out;
      case 'member_expression':
        // `a.b.c`: only the base `a` is a variable read, `.b`/`.c` are property names.
        collectReads(node.childForFieldName('object'), out);
        return out;
      case 'shorthand_property_identifier':
        out.push(node.text); // `{ x }` reads local `x`
        return out;
      case 'property_identifier':
      case 'type_identifier':
      case 'this':
      case 'super':
      case 'string':
      case 'template_string':
      case 'number':
      case 'regex':
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
      } else if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
        const pat = p.childForFieldName('pattern');
        if (pat?.type === 'identifier') pushVar({ scope, name: pat.text, kind: 'param', line: line(p), reads: collectReads(p.childForFieldName('value')) });
      } else if (p.type === 'assignment_pattern') {
        const left = p.childForFieldName('left');
        if (left?.type === 'identifier') pushVar({ scope, name: left.text, kind: 'param', line: line(p), reads: collectReads(p.childForFieldName('right')) });
      } else if (p.type === 'rest_pattern') {
        const inner = named(p)[0];
        if (inner?.type === 'identifier') pushVar({ scope, name: inner.text, kind: 'param', line: line(p), reads: [] });
      }
      // object/array destructuring params are not tracked yet (stage 1 limitation).
    }
  }

  function loopTarget(left: Node | null | undefined): Node | null {
    if (!left) return null;
    if (left.type === 'identifier') return left;
    if (left.type === 'lexical_declaration' || left.type === 'variable_declaration') {
      const decl = named(left).find((c) => c.type === 'variable_declarator');
      const nm = decl?.childForFieldName('name');
      return nm?.type === 'identifier' ? nm : null;
    }
    return null;
  }

  function visitChildren(node: Node, ctx: Ctx) {
    for (const c of named(node)) visit(c, ctx);
  }

  function collectParams(fn: Node, scope: string, ctorClass: string | null) {
    for (const p of named(fn.childForFieldName('parameters'))) {
      if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') continue;
      const pat = p.childForFieldName('pattern');
      const t = typeName(p.childForFieldName('type'));
      if (!pat || pat.type !== 'identifier' || !t) continue;
      facts.types.push({ scope, name: pat.text, type: t });
      // constructor(private graph: CodeGraph) => this.graph
      if (ctorClass && kids(p).some((c) => c.type === 'accessibility_modifier' || c.type === 'readonly')) {
        facts.types.push({ scope: `class:${ctorClass}`, name: `this.${pat.text}`, type: t });
      }
    }
  }
  const ctorType = (v: Node | null | undefined) => (v?.type === 'new_expression' ? chain(v.childForFieldName('constructor')) : null);

  function declareFunction(name: string, node: Node, ctx: Ctx, kind: 'function' | 'method' = 'function') {
    const qname = kind === 'method' && ctx.cls ? `${ctx.cls}.${name}` : qual(ctx, name);
    collectParams(node, qname, kind === 'method' && name === 'constructor' ? ctx.cls : null);
    declareParamVars(node, qname);
    addSymbol({
      name,
      qname,
      kind,
      startLine: line(node),
      endLine: node.endPosition.row + 1,
      className: kind === 'method' ? (ctx.cls ?? undefined) : undefined,
    });
    // Parameter default values / body are visited with this symbol as the caller.
    const inner: Ctx = { caller: qname, cls: kind === 'method' ? ctx.cls : null };
    for (const c of named(node)) visit(c, inner);
    return qname;
  }

  function declareClass(name: string, node: Node, ctx: Ctx): string {
    const qname = qual(ctx, name);
    const bases: string[] = [];
    const heritage = named(node).find((c) => c.type === 'class_heritage');
    if (heritage) {
      for (const c of named(heritage)) {
        if (c.type === 'extends_clause') {
          for (const v of named(c)) {
            if (v.type === 'identifier' || v.type === 'member_expression') {
              const b = chain(v);
              if (b) bases.push(b);
            }
          }
        } else if (c.type === 'identifier' || c.type === 'member_expression') {
          const b = chain(c);
          if (b) bases.push(b);
        }
      }
    }
    addSymbol({ name, qname, kind: 'class', startLine: line(node), endLine: node.endPosition.row + 1, bases });
    const body = node.childForFieldName('body');
    if (body) {
      for (const m of named(body)) {
        if (m.type === 'method_definition') {
          const nm = m.childForFieldName('name');
          if (!nm) continue;
          declareFunction(nm.text, m, { caller: qname, cls: qname }, 'method');
        } else if (m.type === 'public_field_definition' || m.type === 'field_definition') {
          const nm = m.childForFieldName('name') ?? m.childForFieldName('property');
          const val = m.childForFieldName('value');
          const ft = nm ? (typeName(m.childForFieldName('type')) ?? ctorType(val)) : null;
          if (nm && ft) facts.types.push({ scope: `class:${qname}`, name: `this.${nm.text}`, type: ft });
          if (nm && val && FUNC_VALUE.has(val.type)) {
            declareFunction(nm.text, val, { caller: qname, cls: qname }, 'method');
          } else if (val) {
            visit(val, { caller: qname, cls: qname });
          }
        } else {
          visit(m, { caller: qname, cls: qname });
        }
      }
    }
    return qname;
  }

  function handleImport(node: Node) {
    const spec = strLit(node.childForFieldName('source'));
    if (!spec) return;
    const bindings: ImportBinding[] = [];
    const clause = named(node).find((c) => c.type === 'import_clause');
    if (clause) {
      for (const c of named(clause)) {
        if (c.type === 'identifier') bindings.push({ local: c.text, imported: 'default' });
        else if (c.type === 'namespace_import') {
          const id = named(c).find((x) => x.type === 'identifier');
          if (id) bindings.push({ local: id.text, imported: '*' });
        } else if (c.type === 'named_imports') {
          for (const s of named(c)) {
            if (s.type !== 'import_specifier') continue;
            const nm = s.childForFieldName('name');
            const al = s.childForFieldName('alias');
            if (nm) bindings.push({ local: (al ?? nm).text, imported: nm.text });
          }
        }
      }
    }
    facts.imports.push({ specifier: spec, bindings, line: line(node) });
  }

  function handleExport(node: Node, ctx: Ctx) {
    const isDefault = kids(node).some((c) => c.type === 'default');
    const source = strLit(node.childForFieldName('source'));
    const decl = node.childForFieldName('declaration');
    const value = node.childForFieldName('value');

    if (source) {
      const clause = named(node).find((c) => c.type === 'export_clause');
      const ns = named(node).find((c) => c.type === 'namespace_export');
      const imp: ImportFact = { specifier: source, bindings: [], line: line(node) };
      if (clause) {
        for (const s of named(clause)) {
          if (s.type !== 'export_specifier') continue;
          const nm = s.childForFieldName('name');
          const al = s.childForFieldName('alias');
          if (nm) addExport({ name: (al ?? nm).text, from: source, fromName: nm.text });
        }
      } else if (ns) {
        const id = named(ns)[0];
        if (id) addExport({ name: id.text, from: source, fromName: '*' });
      } else {
        imp.star = true;
      }
      facts.imports.push(imp);
      return;
    }

    if (decl) {
      visit(decl, ctx);
      const names = declaredNames(decl);
      if (isDefault) {
        const first = names[0] ?? 'default';
        // anonymous default declarations are registered as symbol "default"
        addExport({ name: 'default', local: declared.has(first) ? first : declared.has('default') ? 'default' : undefined });
      } else {
        for (const n of names) addExport({ name: n, local: n });
      }
      return;
    }

    if (value) {
      // export default <expression>
      if (value.type === 'identifier') {
        addExport({ name: 'default', local: value.text });
      } else if (FUNC_VALUE.has(value.type)) {
        declareFunction('default', value, ctx);
        addExport({ name: 'default', local: 'default' });
      } else if (value.type === 'class') {
        declareClass('default', value, ctx);
        addExport({ name: 'default', local: 'default' });
      } else {
        visit(value, ctx);
      }
      return;
    }

    const clause = named(node).find((c) => c.type === 'export_clause');
    if (clause) {
      for (const s of named(clause)) {
        if (s.type !== 'export_specifier') continue;
        const nm = s.childForFieldName('name');
        const al = s.childForFieldName('alias');
        if (nm) addExport({ name: (al ?? nm).text, local: nm.text });
      }
    }
  }

  function declaredNames(decl: Node): string[] {
    switch (decl.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
      case 'class_declaration':
      case 'abstract_class_declaration': {
        const n = decl.childForFieldName('name');
        return n ? [n.text] : ['default'];
      }
      case 'lexical_declaration':
      case 'variable_declaration':
        return named(decl)
          .filter((c) => c.type === 'variable_declarator')
          .map((c) => c.childForFieldName('name'))
          .filter((n): n is Node => !!n && n.type === 'identifier')
          .map((n) => n.text);
      default:
        return [];
    }
  }

  function handleRequire(node: Node, spec: string) {
    const bindings: ImportBinding[] = [];
    const parent = node.parent;
    if (parent?.type === 'variable_declarator' && parent.childForFieldName('value')?.id === node.id) {
      const target = parent.childForFieldName('name');
      if (target?.type === 'identifier') bindings.push({ local: target.text, imported: '*' });
      else if (target?.type === 'object_pattern') {
        for (const p of named(target)) {
          if (p.type === 'shorthand_property_identifier_pattern') bindings.push({ local: p.text, imported: p.text });
          else if (p.type === 'pair_pattern') {
            const k = p.childForFieldName('key');
            const v = p.childForFieldName('value');
            if (k && v && v.type === 'identifier') bindings.push({ local: v.text, imported: k.text });
          }
        }
      }
    }
    facts.imports.push({ specifier: spec, bindings, line: line(node) });
  }

  function pushCall(c: Omit<CallFact, 'caller'>, ctx: Ctx) {
    facts.calls.push({ caller: ctx.caller, ...c });
  }

  function callFromFn(fn: Node, ctx: Ctx, node: Node, isNew: boolean) {
    if (fn.type === 'identifier') {
      pushCall({ callee: fn.text, kind: isNew ? 'new' : 'plain', line: line(node) }, ctx);
    } else if (fn.type === 'member_expression') {
      const obj = chain(fn.childForFieldName('object'));
      const prop = fn.childForFieldName('property');
      if (!prop) return;
      if (obj === 'this' || obj === 'super') {
        pushCall({ callee: prop.text, receiver: obj, kind: 'this', line: line(node) }, ctx);
      } else {
        pushCall({ callee: prop.text, receiver: obj ?? undefined, kind: isNew ? 'new' : 'member', line: line(node) }, ctx);
      }
    }
  }

  function handleCall(node: Node, ctx: Ctx) {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    if (!fn) return;
    if (fn.type === 'identifier' && fn.text === 'require') {
      const spec = strLit(named(args)[0]);
      if (spec) handleRequire(node, spec);
      return;
    }
    if (fn.type === 'import') {
      const spec = strLit(named(args)[0]);
      if (spec) facts.imports.push({ specifier: spec, bindings: [], line: line(node) });
      return;
    }
    callFromFn(fn, ctx, node, false);
    // identifiers passed as arguments are likely callbacks
    if (args) {
      for (const a of named(args)) {
        if (a.type === 'identifier') pushCall({ callee: a.text, kind: 'ref', line: line(a) }, ctx);
      }
    }
  }

  function handleJsx(node: Node, ctx: Ctx) {
    const name = node.childForFieldName('name');
    if (!name) return;
    const text = name.text;
    if (name.type === 'identifier' && /^[A-Z]/.test(text)) {
      pushCall({ callee: text, kind: 'plain', line: line(node) }, ctx);
    } else if (name.type === 'member_expression' || name.type === 'nested_identifier') {
      const parts = text.split('.');
      if (/^[A-Z]/.test(parts[0])) pushCall({ callee: parts[parts.length - 1], receiver: parts.slice(0, -1).join('.'), kind: 'member', line: line(node) }, ctx);
    }
  }

  function handleAssignment(node: Node, ctx: Ctx): boolean {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (!left || !right || left.type !== 'member_expression') return false;
    const ltext = left.text;
    // Prototype / object-method assignments: `Foo.prototype.bar = function () {}`, `app.handle = function () {}`
    if (ctx.caller === null && FUNC_VALUE.has(right.type)) {
      const parts = (chain(left) ?? '').split('.');
      const isProto = parts.length === 3 && parts[1] === 'prototype';
      const isObj = parts.length === 2 && parts[0] !== 'exports' && parts[0] !== 'module' && parts[0] !== 'this';
      if (isProto || isObj) {
        const cls = parts[0];
        const name = parts[parts.length - 1];
        declareFunction(name, right, { caller: cls, cls }, 'method');
        return true;
      }
    }
    const exportsProp = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(ltext);
    if (exportsProp) {
      const nm = exportsProp[1];
      if (FUNC_VALUE.has(right.type)) declareFunction(nm, right, ctx);
      else if (right.type === 'identifier') addExport({ name: nm, local: right.text });
      else visit(right, ctx);
      if (FUNC_VALUE.has(right.type)) addExport({ name: nm, local: nm });
      return true;
    }
    if (ltext === 'module.exports') {
      if (right.type === 'identifier') addExport({ name: 'default', local: right.text });
      else if (FUNC_VALUE.has(right.type)) {
        const nm = right.childForFieldName('name')?.text ?? 'default';
        declareFunction(nm, right, ctx);
        addExport({ name: 'default', local: nm });
      } else if (right.type === 'class') {
        const nm = right.childForFieldName('name')?.text ?? 'default';
        declareClass(nm, right, ctx);
        addExport({ name: 'default', local: nm });
      } else if (right.type === 'object') {
        for (const p of named(right)) {
          if (p.type === 'shorthand_property_identifier') addExport({ name: p.text, local: p.text });
          else if (p.type === 'method_definition') {
            const nm = p.childForFieldName('name');
            if (nm) {
              declareFunction(nm.text, p, ctx);
              addExport({ name: nm.text, local: nm.text });
            }
          } else if (p.type === 'pair') {
            const k = p.childForFieldName('key');
            const v = p.childForFieldName('value');
            if (!k || !v) continue;
            if (v.type === 'identifier') addExport({ name: k.text, local: v.text });
            else if (FUNC_VALUE.has(v.type)) {
              declareFunction(k.text, v, ctx);
              addExport({ name: k.text, local: k.text });
            } else visit(v, ctx);
          }
        }
      } else visit(right, ctx);
      return true;
    }
    return false;
  }

  function visit(node: Node, ctx: Ctx) {
    if (SKIP.has(node.type)) return;
    switch (node.type) {
      case 'import_statement':
        handleImport(node);
        return;
      case 'export_statement':
        handleExport(node, ctx);
        return;
      case 'function_declaration':
      case 'generator_function_declaration': {
        const nm = node.childForFieldName('name');
        declareFunction(nm ? nm.text : 'default', node, ctx);
        return;
      }
      case 'class_declaration':
      case 'abstract_class_declaration': {
        const nm = node.childForFieldName('name');
        declareClass(nm ? nm.text : 'default', node, ctx);
        return;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        const kw = node.type === 'variable_declaration' ? 'var' : (kids(node).find((c) => c.type === 'const' || c.type === 'let')?.type as 'const' | 'let' | undefined) ?? 'let';
        for (const d of named(node)) {
          if (d.type !== 'variable_declarator') continue;
          const nm = d.childForFieldName('name');
          const val = d.childForFieldName('value');
          if (nm?.type === 'identifier' && !(val && (FUNC_VALUE.has(val.type) || val.type === 'class'))) {
            const t = typeName(d.childForFieldName('type')) ?? ctorType(val);
            if (t) facts.types.push({ scope: ctx.caller, name: nm.text, type: t });
            pushVar({ scope: ctx.caller, name: nm.text, kind: kw, line: line(d), reads: collectReads(val) });
          }
          if (nm?.type === 'identifier' && val && FUNC_VALUE.has(val.type)) declareFunction(nm.text, val, ctx);
          else if (nm?.type === 'identifier' && val?.type === 'class') declareClass(nm.text, val, ctx);
          else if (val) visit(val, ctx);
        }
        return;
      }
      case 'call_expression':
        handleCall(node, ctx);
        // fallthrough: visit callee chain + arguments for nested calls
        for (const c of named(node)) if (c.type !== 'identifier') visit(c, ctx);
        return;
      case 'new_expression': {
        const ctor = node.childForFieldName('constructor');
        if (ctor) callFromFn(ctor, ctx, node, true);
        visitChildren(node, ctx);
        return;
      }
      case 'assignment_expression': {
        const l = node.childForFieldName('left');
        const t = ctorType(node.childForFieldName('right'));
        if (l?.type === 'member_expression' && t && ctx.cls) {
          const lc = chain(l);
          if (lc?.startsWith('this.')) facts.types.push({ scope: `class:${ctx.cls}`, name: lc, type: t });
        }
        if (handleAssignment(node, ctx)) return;
        if (l?.type === 'identifier') {
          pushVar({ scope: ctx.caller, name: l.text, kind: 'assign', line: line(node), reads: collectReads(node.childForFieldName('right')) });
        }
        visitChildren(node, ctx);
        return;
      }
      case 'augmented_assignment_expression': {
        const l = node.childForFieldName('left');
        if (l?.type === 'identifier') {
          const reads = collectReads(node.childForFieldName('right'));
          if (!reads.includes(l.text)) reads.push(l.text);
          pushVar({ scope: ctx.caller, name: l.text, kind: 'aug', line: line(node), reads });
        }
        visitChildren(node, ctx);
        return;
      }
      case 'for_in_statement': {
        const t = loopTarget(node.childForFieldName('left'));
        if (t) pushVar({ scope: ctx.caller, name: t.text, kind: 'loop', line: line(node), reads: collectReads(node.childForFieldName('right')) });
        visitChildren(node, ctx);
        return;
      }
      case 'catch_clause': {
        const p = node.childForFieldName('parameter');
        if (p?.type === 'identifier') pushVar({ scope: ctx.caller, name: p.text, kind: 'catch', line: line(p), reads: [] });
        visitChildren(node, ctx);
        return;
      }
      case 'jsx_opening_element':
      case 'jsx_self_closing_element':
        handleJsx(node, ctx);
        visitChildren(node, ctx);
        return;
      case 'jsx_expression': {
        const only = named(node)[0];
        if (only?.type === 'identifier') pushCall({ callee: only.text, kind: 'ref', line: line(only) }, ctx);
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

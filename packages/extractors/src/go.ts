import type { Node } from '@codegraph/parser';
import { named } from './util';
import type { CallFact, FileFacts, SymbolFact } from './types';

const line = (n: Node) => n.startPosition.row + 1;

/** The scope a function-literal scope sits in: `F/λ1/λ2` -> `F/λ1` -> `F` -> package level (null). */
export function outerScope(scope: string): string | null {
  const i = scope.lastIndexOf('/');
  return i <= 0 ? null : scope.slice(0, i);
}

const unquote = (s: string) => s.replace(/^["`]|["`]$/g, '');

type Shape = Omit<CallFact, 'caller' | 'line'>;

/**
 * A Go type as the resolver wants it, reduced to what decides which methods exist: pointers and generic arguments are
 * dropped, `pkg.T` stays qualified, slices are `[]T`, maps are `{}V` (their value type), and anything that has no repo
 * methods of its own (functions, channels, structs written inline) is a keyword.
 */
function typeStr(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case 'type_identifier':
      return n.text;
    case 'qualified_type': {
      const pkg = n.childForFieldName('package');
      const nm = n.childForFieldName('name');
      return pkg && nm ? `${pkg.text}.${nm.text}` : undefined;
    }
    case 'pointer_type':
    case 'parenthesized_type':
      return typeStr(named(n)[0]);
    case 'generic_type':
      return typeStr(n.childForFieldName('type'));
    case 'slice_type':
    case 'array_type':
    case 'implicit_length_array_type': {
      const el = typeStr(n.childForFieldName('element'));
      return el ? `[]${el}` : 'slice';
    }
    case 'map_type': {
      const v = typeStr(n.childForFieldName('value'));
      return v ? `{}${v}` : 'map';
    }
    case 'function_type':
      return 'func';
    case 'channel_type':
      return 'chan';
    case 'interface_type':
      return 'interface';
    case 'struct_type':
      return 'struct';
    default:
      return undefined;
  }
}

/** `a`, `a.b.c` as text when every step is a plain name; otherwise null. */
function chainText(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'identifier') return n.text;
  if (n.type === 'selector_expression') {
    const o = chainText(n.childForFieldName('operand'));
    const f = n.childForFieldName('field');
    return o && f ? `${o}.${f.text}` : null;
  }
  if (n.type === 'parenthesized_expression') return chainText(named(n)[0]);
  if (n.type === 'index_expression') {
    const o = chainText(n.childForFieldName('operand'));
    return o ? `${o}[]` : null; // an element of a slice or map
  }
  if (n.type === 'unary_expression' && n.text.startsWith('*')) return chainText(named(n)[0]);
  return null;
}

/** The shape of a call expression (null for conversions, immediately-invoked literals and anything computed). */
function callShape(call: Node): Shape | null {
  let fn = call.childForFieldName('function');
  while (fn && (fn.type === 'parenthesized_expression' || fn.type === 'index_expression' || fn.type === 'generic_type')) {
    fn = fn.type === 'index_expression' ? fn.childForFieldName('operand') : fn.type === 'generic_type' ? fn.childForFieldName('type') : named(fn)[0];
  }
  if (!fn) return null;
  if (fn.type === 'identifier') return { callee: fn.text, kind: 'plain' };
  if (fn.type !== 'selector_expression') return null;
  const field = fn.childForFieldName('field');
  if (!field) return null;
  let o = fn.childForFieldName('operand');
  while (o && o.type === 'parenthesized_expression') o = named(o)[0] ?? null;
  const base: Shape = { callee: field.text, kind: 'member' };
  const text = chainText(o);
  if (text) return { ...base, receiver: text };
  if (o?.type === 'call_expression') {
    const f = o.childForFieldName('function');
    if (f?.type === 'identifier' && f.text === 'new') {
      const t = typeStr(named(o.childForFieldName('arguments'))[0]);
      return t ? { ...base, recvType: t } : base;
    }
    const inner = callShape(o);
    return inner ? { ...base, recvCall: inner } : base;
  }
  if (o?.type === 'composite_literal') {
    const t = typeStr(o.childForFieldName('type'));
    return t ? { ...base, recvType: t } : base;
  }
  if (o?.type === 'unary_expression' && o.text.startsWith('&')) {
    const inner = named(o)[0];
    const t = inner?.type === 'composite_literal' ? typeStr(inner.childForFieldName('type')) : undefined;
    return t ? { ...base, recvType: t } : base;
  }
  return base;
}

interface Ctx {
  /** qname of the enclosing function or method; closures keep it. */
  caller: string | null;
  /** Lexical scope: the caller, plus `/λN` for each function literal entered (a literal's parameters must not replace the outer variables). */
  scope: string | null;
}

export function extractGo(path: string, lang: string, root: Node): FileFacts {
  const facts: FileFacts = {
    path, lang, family: 'go', symbols: [], imports: [], exports: [], calls: [], types: [], vars: [], callTypes: [],
    go: { pkg: '', results: {}, fields: {}, locals: {} },
  };
  const go = facts.go!;
  const declared = new Set<string>();

  const addSymbol = (s: SymbolFact) => {
    if (declared.has(s.qname)) return;
    declared.add(s.qname);
    facts.symbols.push(s);
    if (!s.className && /^[A-Z]/.test(s.name)) facts.exports.push({ name: s.name, local: s.qname });
  };
  let literals = 0;
  const local = (scope: string | null, name: string) => {
    if (!scope || name === '_') return;
    (go.locals[scope] ??= []).push(name);
  };
  const typed = (scope: string | null, name: string, type: string | undefined, at: Node) => {
    if (type && name !== '_') facts.types.push({ scope, name, type, line: line(at) });
  };

  /** Types of the variables seen so far in each function, so `y := x` can copy `x`'s type. */
  const known = new Map<string, string>();
  const key = (scope: string | null, name: string) => `${scope ?? ''}|${name}`;
  const setType = (scope: string | null, name: string, type: string | undefined, at: Node) => {
    local(scope, name);
    if (!type) return;
    typed(scope, name, type, at);
    known.set(key(scope, name), type);
  };

  /** What an expression's value is: a type we can read off the syntax, or a call whose result type the resolver finds. */
  function valueOf(e: Node | null | undefined, scope: string | null): { type?: string; call?: Shape } {
    if (!e) return {};
    switch (e.type) {
      case 'composite_literal':
        return { type: typeStr(e.childForFieldName('type')) };
      case 'parenthesized_expression':
        return valueOf(named(e)[0], scope);
      case 'unary_expression':
        return e.text.startsWith('&') ? valueOf(named(e)[0], scope) : {};
      case 'type_assertion_expression':
        return { type: typeStr(e.childForFieldName('type')) };
      case 'identifier':
      case 'selector_expression': {
        const text = chainText(e);
        if (!text) return {};
        for (let s: string | null = scope; ; s = s === null ? null : outerScope(s)) {
          const t = known.get(key(s, text));
          if (t) return { type: t };
          if (s === null) break;
        }
        return { type: `@alias:${text}` }; // a package-level variable, or a field: the resolver knows its type
      }
      case 'call_expression': {
        const fn = e.childForFieldName('function');
        if (fn?.type === 'identifier' && (fn.text === 'new' || fn.text === 'make')) {
          return { type: typeStr(named(e.childForFieldName('arguments'))[0]) };
        }
        const shape = callShape(e);
        return shape ? { call: shape } : {};
      }
      default:
        return {};
    }
  }

  function bind(scope: string | null, names: Node[], values: Node[]) {
    names.forEach((nameNode, i) => {
      if (nameNode.type !== 'identifier') return;
      const name = nameNode.text;
      if (name === '_') return;
      const single = values.length === 1 && names.length > 1;
      const v = valueOf(single ? values[0] : values[i], scope);
      if (v.call) {
        local(scope, name);
        facts.callTypes!.push({ scope, name, call: { ...v.call, line: line(nameNode) }, awaited: false, ...(single ? { index: i } : {}) });
      } else setType(scope, name, v.type, nameNode);
    });
  }

  function params(list: Node | null | undefined, scope: string | null) {
    for (const p of named(list)) {
      if (p.type !== 'parameter_declaration' && p.type !== 'variadic_parameter_declaration') continue;
      let t = typeStr(p.childForFieldName('type'));
      if (p.type === 'variadic_parameter_declaration' && t) t = `[]${t}`;
      for (const n of named(p)) if (n.type === 'identifier') setType(scope, n.text, t, n);
    }
  }

  /** The type of each result, one entry per returned value (`(a, b int)` has two). */
  function results(r: Node | null | undefined): string[] {
    if (!r) return [];
    if (r.type !== 'parameter_list') return [typeStr(r) ?? '?'];
    const out: string[] = [];
    for (const p of named(r)) {
      const t = typeStr(p.childForFieldName('type')) ?? '?';
      const n = named(p).filter((c) => c.type === 'identifier').length;
      for (let i = 0; i < Math.max(1, n); i++) out.push(t);
    }
    return out;
  }

  function declareFunction(node: Node) {
    const nm = node.childForFieldName('name');
    if (!nm) return;
    const recv = node.type === 'method_declaration' ? named(node.childForFieldName('receiver'))[0] : undefined;
    const recvType = recv ? typeStr(recv.childForFieldName('type')) : undefined;
    const isMethod = !!recvType;
    const qname = isMethod ? `${recvType}.${nm.text}` : nm.text;
    const res = results(node.childForFieldName('result'));
    go.results[qname] = res;
    addSymbol({
      name: nm.text, qname, kind: isMethod ? 'method' : 'function', startLine: line(node), endLine: node.endPosition.row + 1,
      ...(isMethod ? { className: recvType } : {}), ...(res[0] && res[0] !== '?' ? { returns: res[0] } : {}),
    });
    if (recv) for (const n of named(recv)) if (n.type === 'identifier') setType(qname, n.text, recvType, n);
    params(node.childForFieldName('parameters'), qname);
    const rl = node.childForFieldName('result');
    if (rl?.type === 'parameter_list') params(rl, qname); // named results are variables too
    const body = node.childForFieldName('body');
    if (body) visit(body, { caller: qname, scope: qname });
  }

  function declareType(spec: Node) {
    const nm = spec.childForFieldName('name');
    const t = spec.childForFieldName('type');
    if (!nm) return;
    const name = nm.text;
    const bases: string[] = [];
    const fields: Record<string, string> = {};
    if (spec.type === 'type_alias') {
      const b = typeStr(t);
      if (b) bases.push(b);
    } else if (t?.type === 'struct_type') {
      for (const fd of named(named(t)[0])) {
        if (fd.type !== 'field_declaration') continue;
        const ft = typeStr(fd.childForFieldName('type'));
        const names = named(fd).filter((c) => c.type === 'field_identifier');
        if (!ft) continue;
        if (names.length) for (const n of names) fields[n.text] = ft;
        else {
          fields[ft.slice(ft.lastIndexOf('.') + 1)] = ft; // an embedded field is named after its type
          bases.push(ft);
        }
      }
    } else if (t?.type === 'interface_type') {
      for (const m of named(t)) {
        if (m.type === 'method_spec') {
          const mn = m.childForFieldName('name');
          if (!mn) continue;
          const q = `${name}.${mn.text}`;
          go.results[q] = results(m.childForFieldName('result'));
          addSymbol({ name: mn.text, qname: q, kind: 'method', className: name, startLine: line(m), endLine: m.endPosition.row + 1 });
        } else {
          const e = named(m).length === 1 ? named(m)[0] : null; // `A | B` unions are constraints, not embedding
          const b = typeStr(e?.type === 'type_elem' ? named(e)[0] : e);
          if (b) bases.push(b);
        }
      }
    }
    go.fields[name] = fields;
    addSymbol({ name, qname: name, kind: 'class', startLine: line(spec), endLine: spec.endPosition.row + 1, bases });
  }

  function declareVars(spec: Node, scope: string | null) {
    const names = named(spec).filter((c) => c.type === 'identifier');
    const t = typeStr(spec.childForFieldName('type'));
    if (t) {
      for (const n of names) setType(scope, n.text, t, n);
      return;
    }
    const value = spec.childForFieldName('value');
    bind(scope, names, named(value));
  }

  function visit(node: Node, ctx: Ctx) {
    switch (node.type) {
      case 'function_declaration':
      case 'method_declaration':
        declareFunction(node);
        return;
      case 'type_declaration':
        for (const c of named(node)) if (c.type === 'type_spec' || c.type === 'type_alias') declareType(c);
        return;
      case 'var_declaration':
        for (const spec of named(node)) {
          const list = spec.type === 'var_spec_list' ? named(spec) : [spec];
          for (const s of list) if (s.type === 'var_spec') declareVars(s, ctx.scope);
          for (const s of list) for (const v of named(s.childForFieldName('value'))) visit(v, ctx);
        }
        return;
      case 'const_declaration': {
        // `const ( A Level = iota; B; C )`: a spec without a type repeats the previous one's.
        let last: string | undefined;
        for (const s of named(node)) {
          if (s.type !== 'const_spec') continue;
          const t = typeStr(s.childForFieldName('type'));
          const vals = named(s.childForFieldName('value'));
          if (t) last = t;
          else if (vals.length) last = undefined;
          const useType = t ?? (vals.length ? undefined : last);
          for (const n of named(s).filter((c) => c.type === 'identifier')) {
            if (useType) setType(ctx.scope, n.text, useType, n);
            else local(ctx.scope, n.text);
          }
          for (const v of vals) visit(v, ctx);
        }
        return;
      }
      case 'func_literal': {
        const inner: Ctx = { caller: ctx.caller, scope: `${ctx.scope ?? ''}/λ${++literals}` };
        params(node.childForFieldName('parameters'), inner.scope);
        const rl = node.childForFieldName('result');
        if (rl?.type === 'parameter_list') params(rl, inner.scope);
        const body = node.childForFieldName('body');
        if (body) visit(body, inner);
        return;
      }
      case 'short_var_declaration':
        bind(ctx.scope, named(node.childForFieldName('left')), named(node.childForFieldName('right')));
        break;
      case 'range_clause': {
        const left = named(node.childForFieldName('left'));
        const right = node.childForFieldName('right');
        // `for _, v := range xs`: v is xs's element type. Only the ranged variable's type is known here, so a field or
        // call result is left to the resolver through an `@elem:` marker.
        const target = left.length >= 2 ? left[1] : null;
        if (target?.type === 'identifier' && target.text !== '_') {
          const chain = chainText(right);
          const direct = chain ? known.get(key(ctx.scope, chain)) : undefined;
          if (direct?.startsWith('[]') || direct?.startsWith('{}')) setType(ctx.scope, target.text, direct.slice(2), target);
          else setType(ctx.scope, target.text, chain ? `@elem:${chain}` : undefined, target);
        }
        if (left[0]?.type === 'identifier') local(ctx.scope, left[0].text);
        break;
      }
      case 'call_expression': {
        const shape = callShape(node);
        if (shape) facts.calls.push({ caller: ctx.caller, ...shape, line: line(node), ...(ctx.scope ? { scope: ctx.scope } : {}) });
        for (const a of named(node.childForFieldName('arguments'))) {
          if (a.type === 'identifier') facts.calls.push({ caller: ctx.caller, callee: a.text, kind: 'ref', line: line(a), ...(ctx.scope ? { scope: ctx.scope } : {}) });
        }
        break;
      }
    }
    for (const c of named(node)) visit(c, ctx);
  }

  for (const top of named(root)) {
    if (top.type === 'comment' && !go.pkg) {
      const m = /^\/\/go:build\s+(.+)$/.exec(top.text);
      if (m) go.build = m[1].trim();
    }
    switch (top.type) {
      case 'package_clause':
        go.pkg = named(top)[0]?.text ?? '';
        break;
      case 'import_declaration':
        for (const spec of named(top).flatMap((c) => (c.type === 'import_spec_list' ? named(c) : [c]))) {
          if (spec.type !== 'import_spec') continue;
          const p = spec.childForFieldName('path');
          if (!p) continue;
          const specifier = unquote(p.text);
          const alias = spec.childForFieldName('name');
          const local = alias ? (alias.type === 'dot' ? '.' : alias.text) : specifier.slice(specifier.lastIndexOf('/') + 1);
          facts.imports.push({ specifier, bindings: [{ local, imported: '*' }], line: line(spec) });
        }
        break;
      default:
        visit(top, { caller: null, scope: null });
    }
  }
  return facts;
}

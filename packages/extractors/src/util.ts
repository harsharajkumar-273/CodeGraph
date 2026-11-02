import type { Node } from '@codegraph/parser';

/** Named children with nulls removed (web-tree-sitter types them as nullable). */
export const named = (n: Node | null | undefined): Node[] => (n?.namedChildren ?? []).filter((c): c is Node => !!c);
/** All children (including anonymous tokens) with nulls removed. */
export const kids = (n: Node | null | undefined): Node[] => (n?.children ?? []).filter((c): c is Node => !!c);

/**
 * How many arguments a call passes, as `{ argc }`, or nothing when it cannot be known from the syntax (a spread such as
 * `f(...xs)`, `f(*xs)`, `f(**kw)` or Go's `f(xs...)`).
 */
export function argCount(args: Node | null | undefined): { argc?: number } {
  if (!args) return {};
  if (args.type === 'generator_expression') return { argc: 1 }; // `f(x for x in y)`: the generator is the one argument
  const list = named(args).filter((a) => a.type !== 'comment');
  const SPREAD = new Set(['spread_element', 'list_splat', 'dictionary_splat', 'parenthesized_list_splat', 'variadic_argument']);
  if (list.some((a) => SPREAD.has(a.type)) || kids(args).some((k) => k.type === '...')) return {};
  return { argc: list.length };
}

/** A parameter as written, on one line and capped, for showing a signature. */
export const paramText = (n: Node): string => n.text.replace(/\s+/g, ' ').trim().slice(0, 80);

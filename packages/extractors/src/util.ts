import type { Node } from '@codegraph/parser';

/** Named children with nulls removed (web-tree-sitter types them as nullable). */
export const named = (n: Node | null | undefined): Node[] => (n?.namedChildren ?? []).filter((c): c is Node => !!c);
/** All children (including anonymous tokens) with nulls removed. */
export const kids = (n: Node | null | undefined): Node[] => (n?.children ?? []).filter((c): c is Node => !!c);

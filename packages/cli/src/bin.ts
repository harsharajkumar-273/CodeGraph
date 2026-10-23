import { parseArgs } from 'node:util';
import { cmdCycles, cmdImpact, cmdIndex, cmdServe, cmdSlice, cmdVars, type Flags } from './commands';
import { cmdMcp } from './mcp';

const HELP = `codegraph — AST dependency, call-graph and blast-radius engine

Usage:
  codegraph index  [path|owner/repo|github-url] [-o graph.json]
  codegraph impact <target> [--repo path] [--depth N] [--min-confidence resolved|probable|ambiguous] [--json]
  (impact also takes --format markdown for a pull request comment, --inline-out <file> for line comments, --no-compare to skip the base commit)
  codegraph impact --diff [--range main...HEAD] [--repo path]   blast radius of a git diff (default: working tree vs HEAD)
  codegraph slice  <target> [--callers N] [--callees N] [--print]
  codegraph vars   <function> | <function#var>   local variables, or one variable's dataflow lineage
  codegraph cycles [path]
  codegraph serve  [path] [--port 4173]
  codegraph mcp    [path]                                       MCP server over stdio, so AI agents can ask what a change touches

Targets:  src/a.ts | src/a.ts#Foo.bar | src/a.ts:42 | Foo.bar
Any command also accepts --graph <graph.json> to skip re-indexing.
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    o: { type: 'string' },
    out: { type: 'string' },
    repo: { type: 'string' },
    graph: { type: 'string' },
    depth: { type: 'string' },
    limit: { type: 'string' },
    port: { type: 'string' },
    callers: { type: 'string' },
    callees: { type: 'string' },
    'min-confidence': { type: 'string' },
    diff: { type: 'boolean' },
    range: { type: 'string' },
    json: { type: 'boolean' },
    'no-compare': { type: 'boolean' },
    'inline-out': { type: 'string' },
    'inline-hotspots': { type: 'boolean' },
    format: { type: 'string' },
    print: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, ...rest] = positionals;
const flags = values as Flags;

const commands: Record<string, (pos: string[], f: Flags) => Promise<void>> = {
  index: cmdIndex,
  impact: cmdImpact,
  slice: cmdSlice,
  vars: cmdVars,
  cycles: cmdCycles,
  serve: cmdServe,
  mcp: cmdMcp,
};

if (!cmd || flags.help || !commands[cmd]) {
  console.log(HELP);
  process.exit(cmd && !flags.help ? 1 : 0);
}
commands[cmd](rest, flags).catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});

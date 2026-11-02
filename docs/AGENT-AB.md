# Agent A/B protocol (not run yet)

`docs/AGENT-EVAL.md` shows the check is accurate on constructed breakage. It does not show that an agent with these tools writes
better code. This is the test that would, written down before any result exists so the outcome cannot shape the method.

**Question.** Does a coding agent that can call `codegraph_check_change` and `codegraph_verify_symbol` leave fewer broken
edits than the same agent without them?

**Tasks.** 30 tasks on 3 repositories (one each in TypeScript, Python and Go) that no one tuned CodeGraph on. Each is a real
refactor that touches shared code: rename a function and update callers, add a required parameter, split a module, change a
return type. Written and frozen before the first run; the agent never sees the checks.

**Arms.** Same model, same prompt, same step limit, same repository snapshot, three runs per task and arm.
A: file tools and a shell only. B: A plus the CodeGraph MCP server.

**Outcome (decided in advance).** After the agent stops, the repository's own compiler or type checker and its test suite
run. Primary: share of runs that compile and pass the tests that passed before. Secondary: calls left behind by removed or
changed functions (counted by the compiler, not by CodeGraph), steps used, tool calls used.

**Reporting.** Both arms' numbers with per-task results, including tasks where B did worse. Failed runs count as failures, not
as missing data. A difference smaller than the run-to-run spread of arm A against itself is reported as no difference.

**What it needs.** An Anthropic API key and a budget (estimate: 30 tasks x 3 runs x 2 arms = 180 runs; at a few tens of
thousands of tokens each, a few dollars to tens of dollars depending on the model). It also needs the three repositories
chosen and the tasks written, which should be done by someone who has not looked at CodeGraph's failure cases.

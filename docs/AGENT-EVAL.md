# Does `check_change` catch a breaking edit before it is written?

`codegraph_check_change` takes the new text of the files an agent is about to write and says what the edit would break. This
page measures that with a mutation test, using the TypeScript compiler as the ground truth.

## Method (`scripts/eval/mutation-bench.mts`)

For functions and methods that have callers, one edit at a time is made in memory (nothing is written):

| edit | should it be flagged? |
|---|---|
| `remove` – delete the function | yes: calls are left behind |
| `add-param` – add a required parameter | yes: calls now pass too few arguments |
| `body-edit` – add a statement inside the body | no |
| `add-func` – add a new function | no |
| `remove-unused` – delete a function nobody calls | no |

The compiler (a `ts.Program` over the repository's tsconfig, with the edited file served from memory) says whether each edit
breaks the build. The call sites the compiler binds to the declaration in the unmutated program (calls, `new`, JSX) are the
truth for *where*. `check_change` gets the same new file text. The baseline is `grep`: every line elsewhere that mentions the
name.

## Result

CodeGraph's own source (96 files; 20 edits per kind, seed 7; raw rows in `docs/eval/mutation-ts-self.json`):

| edit | n | compiler: broken | `check_change`: breaking | caught | false alarms | call-site recall | call-site precision | grep recall | grep precision |
|---|---|---|---|---|---|---|---|---|---|
| remove | 20 | 20 | 20 | 100% | n/a | 100% | 100% | 100% | 34% |
| add-param | 20 | 17 | 15 | 88% | 0% | 86% | 100% | 100% | 34% |
| body-edit | 20 | 0 | 0 | n/a | 0% | | | | |
| add-func | 20 | 0 | 0 | n/a | 0% | | | | |

Median time for a check, including the compiler run: about 3 s (the check itself is well under that).

## What it misses, and what the numbers do not show

- **React components.** All five `add-param` misses (and the two reported as `api-change`) are components used as
  `<Footer />`. CodeGraph does connect a JSX element to its component as a call, but it cannot say whether the element fits:
  that depends on the type of the props, not on an argument count. I tried counting a JSX element as a call with one
  argument; it made things worse (the compiler accepts a second parameter on a component and rejects a changed props type),
  so that change was reverted. Checking props needs type information CodeGraph does not have.
- **A bug this benchmark found and fixed.** The first run found only 73% of the call sites of a removed function: when one
  function called the removed one several times, only one line was kept per caller. All lines are kept now (regression test
  in `packages/analysis/test/analysis.test.ts`), and the same fix improves the pull request comment. The 73% figure was from
  the earlier run; the table is from the run after the fix, on the same 20 functions per kind (same seed), so it is a
  fix verified on the data that found it, not a fresh sample.
- **Grep has higher recall and far lower precision.** Grep finds every mention (100% recall) but 2 of 3 lines it returns are
  not calls (imports, comments, same-named things), and it cannot say whether the edit is a problem at all.
- **One removal of an uncalled function** broke the compiler (it was used as a value, not a call) and was not flagged.
  Only one such candidate existed, so there is no rate to quote.
- This is one TypeScript repository, the one the tool was developed on, so it is the *least* independent test available.
  Python and Go need the same run on other repositories; the script takes any TypeScript repo today, and Go would use the
  compiler the same way. No such run has been done.
- An agent A/B (does an agent with these tools write fewer broken edits?) has **not** been run. The tools are the means; this
  page only shows the check is accurate on constructed breakage.

Reproduce: `npx tsx scripts/eval/mutation-bench.mts <repo> 20 7 out.json`.

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
| remove | 20 | 20 | 20 | 100% | n/a | 73% | 97% | 100% | 34% |
| add-param | 20 | 17 | 15 | 88% | 0% | 86% | 100% | 100% | 35% |
| body-edit | 20 | 0 | 0 | n/a | 0% | | | | |
| add-func | 20 | 0 | 0 | n/a | 0% | | | | |

Median time for a check, including the compiler run: about 3 s (the check itself is well under that).

## What it misses, and what the numbers do not show

- **JSX components.** All five `add-param` misses (and the two reported as `api-change`) are React components used as
  `<Footer />`. A JSX element is not a call edge in CodeGraph, so a changed component signature is not connected to its uses.
  This is a real gap, not a measurement problem.
- **Some call sites of removed functions** (recall 73%): in four functions, half of the sites were missed; the worst cases
  have many callers inside one large file. Not yet root-caused.
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

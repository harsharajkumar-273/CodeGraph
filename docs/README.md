# Documentation

| Page | What it is |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the pieces fit: parser, extractors, analysis, CLI, web app |
| [DEPLOY.md](DEPLOY.md) | Building and hosting the web app |
| [EVALUATION.md](EVALUATION.md) | Hand-labelled precision of the call graph |
| [ORACLE-EVAL.md](ORACLE-EVAL.md) | Precision and recall against the TypeScript compiler, Jedi and the Go type checker |
| [PRECISION.md](PRECISION.md) | How edge samples are drawn for review |
| [AGENT-EVAL.md](AGENT-EVAL.md) | Does `codegraph_check_change` catch breaking edits? (mutation test) |
| [AGENT-AB.md](AGENT-AB.md) | The planned test of whether agents write better code with the tools (not run) |

Raw results live in [eval/](eval/) (JSON per repository and run), samples in [precision-samples/](precision-samples/), and the
scripts that produce them in [../scripts/eval/](../scripts/eval/).

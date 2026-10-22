// Independent ground truth for Go call edges: asks the Go type checker (go/types, through go/packages) which
// declaration every call site binds to. One JSON line per call site, same format and verdicts as ts-oracle.mts and
// py-oracle.py.
//
//	go run . <repo-dir> <graph.json> <out.jsonl>
//
// Only calls whose function is a plain name, `pkg.Name`, `x.Name` or `f[T]` are considered (the shapes CodeGraph
// extracts). Verdicts:
//
//	internal  binds to a function, method or interface method declared in this repo that has a graph node
//	nosym     binds to repo code with no graph node: a function value held in a variable or field, or a type conversion
//	external  binds outside the repo (standard library, dependencies) or is a built-in -> any internal edge is wrong
//	unknown   the checker could not resolve it (type errors) -> not scored
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

type row struct {
	File    string   `json:"file"`
	Line    int      `json:"line"`
	Callee  string   `json:"callee"`
	IsNew   bool     `json:"isNew"`
	Verdict string   `json:"verdict"`
	Target  string   `json:"target,omitempty"`
	Alts    []string `json:"alts,omitempty"`
	At      string   `json:"at,omitempty"`
}

func main() {
	root, err := filepath.Abs(os.Args[1])
	check(err)
	nodes := loadNodes(os.Args[2])
	cfg := &packages.Config{
		Mode:  packages.NeedName | packages.NeedFiles | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps,
		Dir:   root,
		Tests: true,
	}
	pkgs, err := packages.Load(cfg, "./...")
	check(err)

	rel := func(abs string) (string, bool) {
		r, err := filepath.Rel(root, abs)
		if err != nil || strings.HasPrefix(r, "..") {
			return "", false
		}
		return filepath.ToSlash(r), true
	}
	seen := map[string]bool{}
	var rows []row
	for _, pkg := range pkgs {
		for _, f := range pkg.Syntax {
			path, ok := rel(pkg.Fset.Position(f.Pos()).Filename)
			if !ok {
				continue
			}
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				name, id, sel := callee(call.Fun)
				if name == "" {
					return true
				}
				pos := pkg.Fset.Position(call.Pos())
				k := fmt.Sprintf("%s:%d:%d", path, pos.Line, pos.Column)
				if seen[k] {
					return true
				}
				seen[k] = true
				r := row{File: path, Line: pos.Line, Callee: name}
				r.Verdict, r.Target, r.Alts, r.At = classify(pkg, id, sel, rel, nodes)
				rows = append(rows, r)
				return true
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].File != rows[j].File {
			return rows[i].File < rows[j].File
		}
		return rows[i].Line < rows[j].Line
	})
	out, err := os.Create(os.Args[3])
	check(err)
	defer out.Close()
	counts := map[string]int{}
	enc := json.NewEncoder(out)
	for _, r := range rows {
		counts[r.Verdict]++
		check(enc.Encode(r))
	}
	fmt.Printf("%s: %d call sites %v\n", os.Args[3], len(rows), counts)
}

// callee unwraps the callee expression to the name CodeGraph records.
func callee(fun ast.Expr) (string, *ast.Ident, *ast.SelectorExpr) {
	for {
		switch f := fun.(type) {
		case *ast.ParenExpr:
			fun = f.X
		case *ast.IndexExpr:
			fun = f.X
		case *ast.IndexListExpr:
			fun = f.X
		case *ast.Ident:
			return f.Name, f, nil
		case *ast.SelectorExpr:
			return f.Sel.Name, nil, f
		default:
			return "", nil, nil
		}
	}
}

func classify(pkg *packages.Package, id *ast.Ident, sel *ast.SelectorExpr, rel func(string) (string, bool), nodes map[string]bool) (verdict, target string, alts []string, at string) {
	info := pkg.TypesInfo
	var obj types.Object
	if id != nil {
		obj = info.Uses[id]
	} else if s, ok := info.Selections[sel]; ok {
		obj = s.Obj()
	} else {
		obj = info.Uses[sel.Sel]
	}
	switch o := obj.(type) {
	case nil:
		return "unknown", "", nil, ""
	case *types.Builtin:
		return "external", "", nil, "builtin"
	case *types.TypeName:
		return "nosym", "", nil, "conversion"
	case *types.Var:
		return "nosym", "", nil, "function value"
	case *types.Func:
		fn := o.Origin()
		if fn.Pkg() == nil {
			return "external", "", nil, "universe"
		}
		path, ok := rel(pkg.Fset.Position(fn.Pos()).Filename)
		if !ok {
			return "external", "", nil, fn.Pkg().Path()
		}
		q := fn.Name()
		if sig, ok := fn.Type().(*types.Signature); ok && sig.Recv() != nil {
			t := sig.Recv().Type()
			if p, ok := t.(*types.Pointer); ok {
				t = p.Elem()
			}
			if n, ok := t.(*types.Named); ok {
				q = n.Obj().Name() + "." + fn.Name()
			} else {
				return "nosym", "", nil, path // a method of an unnamed interface
			}
		}
		node := path + "#" + q
		if nodes[node] {
			return "internal", node, []string{node}, node
		}
		return "nosym", "", nil, node
	}
	return "unknown", "", nil, ""
}

func loadNodes(path string) map[string]bool {
	b, err := os.ReadFile(path)
	check(err)
	var g struct {
		Nodes []struct {
			Kind          string `json:"kind"`
			File          string `json:"file"`
			QualifiedName string `json:"qualifiedName"`
		} `json:"nodes"`
	}
	check(json.Unmarshal(b, &g))
	out := map[string]bool{}
	for _, n := range g.Nodes {
		if n.File != "" && (n.Kind == "function" || n.Kind == "method" || n.Kind == "class") {
			out[n.File+"#"+n.QualifiedName] = true
		}
	}
	return out
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

var _ = token.NoPos

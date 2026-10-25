package compiler

import (
	"strings"
	"testing"

	"github.com/ballerina-nutcracker/ballerina/ast"
)

func errorTestLowerer(t *testing.T, source string) (*lowerer, sourceFunctionEntry) {
	t.Helper()
	p, diagnostics, err := resolveProgram(project(source))
	if err != nil || p == nil {
		t.Fatalf("resolve: %v: %+v", err, diagnostics)
	}
	l := &lowerer{p: p}
	functions, err := l.collectFunctions()
	if err != nil {
		t.Fatal(err)
	}
	for _, fn := range functions {
		if fn.node.GetName().GetValue() == "main" {
			return l, fn
		}
	}
	t.Fatal("missing main")
	return nil, sourceFunctionEntry{}
}

func TestLoweringReturnPortPresence(t *testing.T) {
	for _, body := range []string{"{ return dead(); }", "=> dead();"} {
		t.Run(body, func(t *testing.T) {
			l, fn := errorTestLowerer(t, "function dead() returns int { panic error(\"stop\"); } function main() returns int "+body)
			graph, err := l.lowerFunction(fn)
			if err != nil {
				t.Fatal(err)
			}
			// Evaluate only the generic continuation query: a collapsed call
			// continues, while the expanded panic-only callee does not.
			var evaluate func(HIRPresence, bool) bool
			evaluate = func(p HIRPresence, continuation bool) bool {
				switch v := p.Value.(type) {
				case HIRConstantPresence:
					return v.Value
				case HIRNonemptyPresence:
					if v.InterfaceID == "entry" {
						return true
					}
					if v.InterfaceID == "returns" {
						return false
					}
					return continuation
				case HIRNotPresence:
					return !evaluate(v.Operand, continuation)
				case HIRAllPresence:
					for _, child := range v.Operands {
						if !evaluate(child, continuation) {
							return false
						}
					}
					return true
				case HIRAnyPresence:
					for _, child := range v.Operands {
						if evaluate(child, continuation) {
							return true
						}
					}
					return false
				default:
					t.Fatalf("unexpected presence %T", p.Value)
					return false
				}
			}
			count := 0
			for _, port := range graph.Ports {
				if port.Role != HIRPortRoleReturn {
					continue
				}
				count++
				for _, plan := range []HIREmissionPlan{graph.Emission.Root, graph.Emission.Inline} {
					found := false
					for _, slot := range plan.Ports {
						local, ok := slot.Value.(HIRLocalEmission)
						if !ok || local.ItemID != port.ID {
							continue
						}
						found = true
						if !evaluate(local.When, true) || evaluate(local.When, false) {
							t.Fatal("return port must follow callee continuation")
						}
						for _, face := range graph.Interfaces {
							for _, member := range face.Members {
								if member.PortID != port.ID {
									continue
								}
								// The member includes its own unconditional guard.
								if !evaluate(member.When, true) || evaluate(member.When, false) {
									t.Fatal("return interface must follow callee continuation")
								}
							}
						}
					}
					if !found {
						t.Fatal("missing return port emission")
					}
				}
			}
			if count != 1 {
				t.Fatalf("return ports: %d", count)
			}
		})
	}
}

func TestLoweringEmptyNestedBlocks(t *testing.T) {
	for _, body := range []string{
		"{} _ = 1;",
		"{{}} _ = 1;",
		"_ = 1; {} _ = 2;",
		"_ = 1; {{}}",
		"return; {} _ = 1;",
	} {
		t.Run(body, func(t *testing.T) {
			l, fn := errorTestLowerer(t, "public function main() {"+body+"}")
			b := &graphBuilder{l: l, ports: map[string]bool{}}
			statements := fn.node.GetBody().(*ast.BLangBlockFunctionBody).Stmts
			f, err := b.lowerBlock(fn.id, statements)
			if err != nil {
				t.Fatal(err)
			}
			if len(f.nodes) == 0 || len(f.entry) != 1 {
				t.Fatalf("empty block lost visible entry: %+v", f)
			}
			if f.entry[0].PortID != f.nodes[0]+":entry" {
				t.Fatalf("entry does not reach first visible node: %+v", f.entry)
			}
			wantEdges := 0
			if strings.Contains(body, "= 2") {
				wantEdges = 1
			}
			if len(b.graph.Edges) != wantEdges {
				t.Fatalf("sequence edges: got %d, want %d", len(b.graph.Edges), wantEdges)
			}
			if !strings.Contains(body, "return") && len(f.normal) != 1 {
				t.Fatalf("trailing empty block lost normal completion: %+v", f.normal)
			}
		})
	}
	if !(fragment{}).empty() || (fragment{nodes: []string{"unsupported"}}).empty() || (fragment{returns: member("return")}).empty() {
		t.Fatal("empty fragments must be distinguished from regions without incoming members")
	}
}

func TestLoweringSourceErrorsReturn(t *testing.T) {
	for _, boundary := range []string{"source", "statement", "block", "expression", "expression-return", "scan-calls", "function"} {
		for _, failure := range []string{"identity", "offset"} {
			t.Run(boundary+"/"+failure, func(t *testing.T) {
				l, fn := errorTestLowerer(t, "function value() returns int => 1; public function main() { int a = value(); _ = a; }")
				statement := fn.node.GetBody().(*ast.BLangBlockFunctionBody).Stmts[0]
				expr := statement.(*ast.BLangVariableDef).Var.Expr
				id := "test"
				conflictID := id
				if boundary == "block" {
					conflictID += "/statement/0"
				}
				if boundary == "function" {
					conflictID = fn.id + "/statement/0"
				}
				if boundary == "scan-calls" {
					conflictID += "/call/0"
				}
				if failure == "identity" {
					if _, err := l.located(conflictID, fn.node); err != nil {
						t.Fatal(err)
					}
				} else {
					// The resolved AST keeps its original offsets, but its source
					// document is now too short to contain those ranges.
					for name := range l.p.files {
						l.p.files[name] = ""
					}
				}
				b := &graphBuilder{l: l, ports: map[string]bool{}}
				var err error
				switch boundary {
				case "source":
					_, err = b.source(id, expr)
				case "statement":
					_, err = b.lowerStatement(id, id, statement)
				case "block":
					_, err = b.lowerBlock(id, []ast.StatementNode{statement})
				case "expression":
					_, err = b.lowerExpression(id, id, expr, nil)
				case "expression-return":
					_, err = b.lowerExpressionReturn(id, id, expr)
				case "scan-calls":
					_, _, err = b.scanCalls(id, expr, true)
				case "function":
					_, err = l.lowerFunction(fn)
				}
				if err == nil {
					t.Fatal("source error was swallowed")
				}
			})
		}
	}
}

func TestLoweringClientErrorsReturn(t *testing.T) {
	for _, boundary := range []string{"helper", "expression", "statement", "function"} {
		t.Run(boundary, func(t *testing.T) {
			l, fn := errorTestLowerer(t, `import ballerina/http;
final http:Client c = check new ("https://example.test");
public function main() returns error? { string response = check c->get("/"); _ = response; }`)
			statement := fn.node.GetBody().(*ast.BLangBlockFunctionBody).Stmts[0]
			expr := statement.(*ast.BLangVariableDef).Var.Expr
			b := &graphBuilder{l: l, ports: map[string]bool{}}
			id := fn.id + "/statement/0"
			calls, _, err := b.scanCalls(id, expr, true)
			if err != nil || len(calls) != 1 {
				t.Fatalf("calls: %+v: %v", calls, err)
			}
			// Receiver provenance errors arise after call scanning succeeds.
			if _, err := l.located(calls[0].id+"/receiver", fn.node); err != nil {
				t.Fatal(err)
			}
			switch boundary {
			case "helper":
				_, err = b.clientPresentation(&calls[0], "occurrence")
			case "expression":
				_, err = b.lowerExpression(id+"/value", "occurrence", expr, calls)
			case "statement":
				_, err = b.lowerStatement(id, "occurrence", statement)
			case "function":
				_, err = l.lowerFunction(fn)
			}
			if err == nil || !strings.Contains(err.Error(), "conflicting source identity") {
				t.Fatalf("expected client provenance error, got %v", err)
			}
		})
	}
}

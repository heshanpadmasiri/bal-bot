package compiler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/ballerina-nutcracker/ballerina/ast"
	"github.com/ballerina-nutcracker/ballerina/semtypes"
)

// This suite intentionally uses the post-baseline HIR corpus, not rendering fixtures.
func TestHIRSharedContract(t *testing.T) {
	dir := filepath.Join("..", "..", "tests", "fixtures", "hir-contract")
	var corpus struct {
		Cases []struct {
			Name   string `json:"name"`
			File   string `json:"file"`
			Accept bool   `json:"accept"`
		} `json:"cases"`
	}
	data, err := os.ReadFile(filepath.Join(dir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) == 0 {
		t.Fatal("empty HIR corpus")
	}
	for _, c := range corpus.Cases {
		t.Run(c.Name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, c.File))
			if err != nil {
				t.Fatal(err)
			}
			var program HIRProgram
			decodeErr := json.Unmarshal(data, &program)
			// Malformed JSON shape may be rejected by either the codec or validator.
			if decodeErr != nil {
				if c.Accept {
					t.Fatalf("valid fixture failed decoding: %v", decodeErr)
				}
				return
			}
			before, err := json.Marshal(program)
			if err != nil {
				if c.Accept {
					t.Fatal(err)
				}
				if err := ValidateHIR(program); err == nil {
					t.Fatal("validator accepted an unencodable program")
				}
				return
			}
			validationErr := ValidateHIR(program)
			after, err := json.Marshal(program)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("ValidateHIR mutated input")
			}
			printed, printErr := PrintHIR(program)
			if !c.Accept {
				if validationErr == nil {
					t.Error("accepted malformed fixture")
				}
				if printErr == nil {
					t.Error("PrintHIR accepted malformed fixture")
				}
				return
			}
			if validationErr != nil {
				t.Fatalf("rejected valid fixture: %v", validationErr)
			}
			if printErr != nil {
				t.Fatal(printErr)
			}
			if len(printed) == 0 || printed[len(printed)-1] != '\n' {
				t.Fatal("missing final newline")
			}
			var original, roundtrip any
			if err := json.Unmarshal(data, &original); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(printed), &roundtrip); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(original, roundtrip) {
				t.Fatal("printing changed wire data or meaningful array order")
			}
			var decoded HIRProgram
			if err := json.Unmarshal([]byte(printed), &decoded); err != nil {
				t.Fatal(err)
			}
			if err := ValidateHIR(decoded); err != nil {
				t.Fatal(err)
			}
			again, err := PrintHIR(decoded)
			if err != nil || printed != again {
				t.Fatalf("noncanonical second print: %v", err)
			}
			// Rebuild records in descending key order. Arrays must remain untouched.
			program.Sources = hirReverseRecord(program.Sources)
			program.Functions = hirReverseRecord(program.Functions)
			again, err = PrintHIR(program)
			if err != nil || printed != again {
				t.Fatalf("record insertion order changed output: %v", err)
			}
			after, err = json.Marshal(program)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("PrintHIR mutated input: %v", err)
			}
		})
	}
}

func TestHIREmptyCollectionsEncoding(t *testing.T) {
	// The Go zero value uses nil slices/maps, but the wire contract never does.
	var program HIRProgram
	data, err := json.Marshal(program)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"scopes":[],"sources":{},"functions":{}}` {
		t.Fatalf("noncanonical empty collections: %s", data)
	}
	printed, err := PrintHIR(program)
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip HIRProgram
	if err := json.Unmarshal([]byte(printed), &roundtrip); err != nil {
		t.Fatal(err)
	}
	if err := ValidateHIR(roundtrip); err != nil {
		t.Fatal(err)
	}
}

// Twenty-four independent choices represent 2^24 expansion assignments. The
// partition must be checked symbolically, including the single all-expanded
// assignment; checking only all-collapsed or each reference in isolation misses it.
func TestHIRSymbolicIndependentReferences(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "tests", "fixtures", "hir-contract", "symbolic-24-independent-references.json"))
	if err != nil {
		t.Fatal(err)
	}
	var program HIRProgram
	if err := json.Unmarshal(data, &program); err != nil {
		t.Fatal(err)
	}
	graph := program.Functions["main"]
	if len(graph.Nodes) != 24 {
		t.Fatalf("expected 24 independent references, got %d", len(graph.Nodes))
	}
	condition := graph.Edges[0].When
	graph.Edges[0].When = HIRPresence{Value: HIRConstantPresence{Value: true}}
	partition := HIREmission{Value: HIRLocalEmission{
		ItemID: "all-expanded", When: HIRPresence{Value: HIRNotPresence{Operand: condition}},
	}}
	graph.Emission.Root.Edges = append(graph.Emission.Root.Edges, partition)
	graph.Emission.Inline.Edges = append(graph.Emission.Inline.Edges, partition)
	program.Functions["main"] = graph
	if err := ValidateHIR(program); err != nil {
		t.Fatalf("disjoint, exhaustive partition rejected: %v", err)
	}
	// Remove only the conjunction slot, leaving every other assignment covered.
	original := graph.Emission.Root.Edges
	graph.Emission.Root.Edges = append(append(HIRList[HIREmission]{}, original[:len(original)-2]...), partition)
	program.Functions["main"] = graph
	if err := ValidateHIR(program); err == nil {
		t.Fatal("accepted uncovered all-expanded assignment")
	}
	// Duplicate only the conjunction slot: overlap exists in just one assignment.
	graph.Emission.Root.Edges = append(original, original[len(original)-2])
	program.Functions["main"] = graph
	if err := ValidateHIR(program); err == nil {
		t.Fatal("accepted duplicate emission in all-expanded assignment")
	}
}

// printFrontend describes the actual lowering input, not a semantic-analysis or
// desugared AST. Each upstream printer is fresh because its buffer is stateful.
func printFrontend(p *resolvedProgram) (output string, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			output = ""
			err = fmt.Errorf("print frontend: %v", recovered)
		}
	}()
	if p == nil || p.env == nil {
		return "", fmt.Errorf("print frontend: missing resolved program")
	}
	fragment := func(node ast.BLangNode) string {
		printer := &ast.PrettyPrinter{ShowNodeLocations: true, DiagnosticEnv: p.env.DiagnosticEnv()}
		return printer.Print(node)
	}
	var out strings.Builder
	out.WriteString("# Frontend: ResolveSymbols + ResolvePublicNodeTypes + ResolvePrivateNodesTypes\n# Before semantic analysis, CFG, desugaring, and lowering\n# ast.PrettyPrinter ShowNodeLocations=true DiagnosticEnv=resolved environment\n")
	type document struct {
		moduleID, name string
		unit           *ast.BLangCompilationUnit
	}
	var documents []document
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		if len(mod.units) != len(mod.documentNames) {
			return "", fmt.Errorf("print frontend: compilation unit/document mismatch")
		}
		moduleID := mod.module.Descriptor().Org().Value() + "/" + mod.module.ModuleName().String()
		for i, unit := range mod.units {
			documents = append(documents, document{moduleID, mod.documentNames[i], unit})
		}
	}
	sort.Slice(documents, func(i, j int) bool {
		if documents[i].moduleID != documents[j].moduleID {
			return documents[i].moduleID < documents[j].moduleID
		}
		return documents[i].name < documents[j].name
	})
	for _, doc := range documents {
		fmt.Fprintf(&out, "\n## Module %s / Document %s\n", doc.moduleID, doc.name)
		out.WriteString(fragment(doc.unit))
		out.WriteByte('\n')
	}
	type provenance struct {
		file, kind string
		start, end int
		node       ast.BLangNode
		args       []ast.BLangExpression
	}
	var originals []provenance
	add := func(kind string, node ast.BLangNode, args []ast.BLangExpression) {
		loc := node.GetPosition()
		originals = append(originals, provenance{p.env.DiagnosticEnv().FileName(loc), kind, loc.StartOffset(), loc.EndOffset(), node, args})
	}
	for call, args := range p.sourceCallArgs {
		add("call", call, args)
	}
	for expr, args := range p.sourceNewArgs {
		add("new", expr, args)
	}
	sort.Slice(originals, func(i, j int) bool {
		a, b := originals[i], originals[j]
		if a.file != b.file {
			return a.file < b.file
		}
		if a.start != b.start {
			return a.start < b.start
		}
		if a.end != b.end {
			return a.end < b.end
		}
		return a.kind < b.kind
	})
	out.WriteString("\n## Original source argument provenance (source order; zero-based byte offsets)\n")
	for _, original := range originals {
		fmt.Fprintf(&out, "\n### %s %s [%d,%d)\n", original.kind, original.file, original.start, original.end)
		// Include receiver and computed resource paths explicitly; these are not
		// part of the argument snapshot and remain original resolved nodes.
		if call, ok := original.node.(ast.Invocable); ok {
			if receiver := call.Receiver(); receiver != nil {
				out.WriteString("receiver:\n" + fragment(receiver) + "\n")
			}
			for i, path := range resourcePathExpressions(call) {
				fmt.Fprintf(&out, "resource-path[%d]:\n%s\n", i, fragment(path))
			}
		}
		fmt.Fprintf(&out, "arguments: %d\n", len(original.args))
		for i, arg := range original.args {
			fmt.Fprintf(&out, "argument[%d]:\n%s\n", i, fragment(arg))
		}
	}
	return out.String(), nil
}

func TestHIRFrontendResolvedInput(t *testing.T) {
	p, items, err := resolveProgram(project(`function step(int i, int increment = 1) returns int { return i + increment; }
public function main() {
 int i = 0;
 while i < 3 { i = step(increment = 2, i = i); }
 foreach int n in [1, 2] { i += n; }
 i = step(i);
}`))
	if err != nil || p == nil {
		t.Fatalf("resolve: %v: %+v", err, items)
	}
	var main, step *ast.BLangFunction
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		for _, fn := range mod.pkg.Functions {
			switch fn.Name.GetValue() {
			case "main":
				main = fn
			case "step":
				step = fn
			}
		}
	}
	if main == nil || step == nil {
		t.Fatal("missing resolved functions")
	}
	body := main.Body.(*ast.BLangBlockFunctionBody)
	loop, ok := body.Stmts[1].(*ast.BLangWhile)
	if !ok {
		t.Fatalf("while was lowered: %T", body.Stmts[1])
	}
	if _, ok := body.Stmts[2].(*ast.BLangForeach); !ok {
		t.Fatalf("foreach was lowered: %T", body.Stmts[2])
	}
	call := loop.Body.Stmts[0].(*ast.BLangAssignment).Expr.(*ast.BLangInvocation)
	if call.Symbol().IsEmpty() || call.Symbol() != step.Symbol() {
		t.Fatal("call does not retain resolved function symbol")
	}
	param := step.GetParameters()[0]
	if param.Symbol().IsEmpty() || !semtypes.IsSameType(semtypes.ContextFrom(p.env.GetTypeEnv()), p.env.SymbolType(param.Symbol()), semtypes.Int) {
		t.Fatal("parameter type was not resolved to int")
	}
	args := p.sourceCallArgs[call]
	if len(args) != 2 {
		t.Fatalf("missing original named args: %d", len(args))
	}
	for i, want := range []string{"increment = 2", "i = i"} {
		if got := p.located("argument", args[i]).Text; got != want {
			t.Fatalf("argument[%d]: %q, want %q", i, got, want)
		}
	}
	defaultCall := body.Stmts[3].(*ast.BLangAssignment).Expr.(*ast.BLangInvocation)
	if saved := p.sourceCallArgs[defaultCall]; len(saved) != 1 || p.located("default-argument", saved[0]).Text != "i" {
		t.Fatal("omitted default argument was inserted into original source snapshot")
	}
	// Resolution reordered call arguments; the preserved snapshot must not follow it.
	if reflect.DeepEqual(call.CallArgs(), args) {
		t.Fatal("test did not exercise argument rewriting")
	}
	if _, err := printFrontend(p); err != nil {
		t.Fatal(err)
	}
	if _, ok := body.Stmts[1].(*ast.BLangWhile); !ok {
		t.Fatal("printer lowered while")
	}
	if _, ok := body.Stmts[2].(*ast.BLangForeach); !ok {
		t.Fatal("printer lowered foreach")
	}
}

func TestHIRFrontendPrinterDeterministicAndReadOnly(t *testing.T) {
	files := exampleFiles(t, "definitions-and-calls")
	files["extra.bal"] = "function extra() returns int => 9;\r\n"
	p, items, err := resolveProgram(files)
	if err != nil || p == nil {
		t.Fatalf("resolve: %v: %+v", err, items)
	}
	calls := map[ast.Invocable][]ast.BLangExpression{}
	news := map[*ast.BLangNewExpression][]ast.BLangExpression{}
	for call, args := range p.sourceCallArgs {
		calls[call] = append([]ast.BLangExpression{}, args...)
	}
	for expr, args := range p.sourceNewArgs {
		news[expr] = append([]ast.BLangExpression{}, args...)
	}
	first, err := printFrontend(p)
	if err != nil {
		t.Fatal(err)
	}
	second, err := printFrontend(p)
	if err != nil || first != second {
		t.Fatalf("repeated print differs: %v", err)
	}
	if !reflect.DeepEqual(calls, p.sourceCallArgs) || !reflect.DeepEqual(news, p.sourceNewArgs) {
		t.Fatal("printing mutated source provenance")
	}
	if strings.Contains(first, "::") || strings.Contains(first, "## Module ballerina/") {
		t.Fatal("dependency AST leaked into workspace dump")
	}
	if !strings.Contains(first, "Document modules/math/") || !strings.Contains(first, "Document extra.bal") {
		t.Fatal("workspace-relative document provenance missing")
	}
	keys := make([]string, 0, len(files))
	for key := range files {
		keys = append(keys, key)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(keys)))
	reordered := Files{}
	for _, key := range keys {
		reordered[key] = files[key]
	}
	other, diagnostics, err := resolveProgram(reordered)
	if err != nil || other == nil {
		t.Fatalf("resolve reordered: %v: %+v", err, diagnostics)
	}
	third, err := printFrontend(other)
	if err != nil || first != third {
		t.Fatalf("input map order changed frontend output: %v", err)
	}
}

func TestHIRFrontendReceiverConstructorAndComputedTarget(t *testing.T) {
	p, items, err := resolveProgram(project(`client class Queue {
 public function init(string host, int port = 12) { _ = host; _ = port; }
 remote function read(string topic = "jobs") returns string|error { return topic; }
 resource function get item/[int id]() returns string { return "item"; }
}
function index() returns int { return 0; }
function fill(Queue queue, string[] values) returns error? {
 values[index()] = check queue->read(topic = "orders");
 string item = queue->/item/[index()].get();
 _ = item;
}
public function main() { Queue queue = new (port = 99, host = "host"); _ = queue; }`))
	if err != nil || p == nil {
		t.Fatalf("resolve: %v: %+v", err, items)
	}
	var computed, receiver, resource, constructor bool
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		ast.Walk(sourceVisitor(func(node ast.BLangNode) bool {
			if assignment, ok := node.(*ast.BLangAssignment); ok {
				if target, ok := assignment.VarRef.(*ast.BLangIndexBasedAccess); ok {
					_, computed = target.IndexExpr.(*ast.BLangInvocation)
				}
			}
			return true
		}), mod.pkg)
	}
	for call, args := range p.sourceCallArgs {
		if remote, ok := call.(*ast.BLangRemoteMethodCallAction); ok {
			receiver = remote.Receiver() != nil && p.located("receiver", remote.Receiver()).Text == "queue" && len(args) == 1 && p.located("arg", args[0]).Text == `topic = "orders"`
		}
		if _, ok := call.(*ast.BLangClientResourceAccessAction); ok {
			paths := resourcePathExpressions(call)
			resource = len(paths) == 1 && p.located("path", paths[0]).Text == "index()"
		}
	}
	for _, args := range p.sourceNewArgs {
		if len(args) == 2 {
			constructor = p.located("arg", args[0]).Text == "port = 99" && p.located("arg", args[1]).Text == `host = "host"`
		}
	}
	if !computed || !receiver || !resource || !constructor {
		t.Fatalf("lost original lowering input: computed=%v receiver=%v resource=%v constructor=%v", computed, receiver, resource, constructor)
	}
	printed, err := printFrontend(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"receiver:", "resource-path[0]:", "### new", "argument[1]:"} {
		if !strings.Contains(printed, want) {
			t.Fatalf("missing provenance %q", want)
		}
	}
}

func hirReverseRecord[T any](record HIRRecord[T]) HIRRecord[T] {
	keys := make([]string, 0, len(record))
	for key := range record {
		keys = append(keys, key)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(keys)))
	result := make(HIRRecord[T], len(record))
	for _, key := range keys {
		result[key] = record[key]
	}
	return result
}

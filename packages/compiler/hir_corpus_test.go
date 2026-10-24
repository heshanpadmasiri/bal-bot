package compiler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

var updateHIRGoldens = flag.Bool("update", false, "explicitly update only hir-projects AST/diagnostic (and later HIR) goldens")

const hirProjectsRoot = "../../tests/fixtures/hir-projects"

type hirCorpusCase struct {
	ID           string            `json:"id"`
	Kind         string            `json:"kind"`
	Directory    string            `json:"directory"`
	InputHash    string            `json:"inputHash"`
	CatalogRef   string            `json:"catalogRef"`
	SourceHashes map[string]string `json:"sourceHashes"`
	AST          *string           `json:"ast"`
	Diagnostics  *string           `json:"diagnostics"`
	Reason       string            `json:"reason"`
	Provenance   []struct {
		File string `json:"file"`
	} `json:"provenance"`
}

func readHIRCorpus(t *testing.T) []hirCorpusCase {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(hirProjectsRoot, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Cases []hirCorpusCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Cases) == 0 {
		t.Fatal("empty HIR project corpus")
	}
	return manifest.Cases
}

func readHIRSources(t *testing.T, root string) Files {
	t.Helper()
	files := Files{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".bal") && !strings.HasSuffix(path, ".toml") {
			return fmt.Errorf("unexpected project source file %s", path)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(relative)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestHIRCorpusCoverage(t *testing.T) {
	var catalog map[string]struct {
		Kind  string `json:"kind"`
		Files Files  `json:"files"`
	}
	data, err := os.ReadFile("../../tests/fixtures/flow-rendering/inputs/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	ids := map[string]bool{}
	directories := map[string]bool{}
	for _, c := range readHIRCorpus(t) {
		if ids[c.ID] {
			t.Fatalf("duplicate corpus ID %s", c.ID)
		}
		ids[c.ID] = true
		if len(c.Provenance) == 0 {
			t.Fatalf("%s has no provenance", c.ID)
		}
		for _, p := range c.Provenance {
			if _, err := os.Stat(filepath.Join("../..", p.File)); err != nil {
				t.Fatalf("%s provenance: %v", c.ID, err)
			}
		}
		if c.CatalogRef != "" {
			input, ok := catalog[c.CatalogRef]
			if !ok || input.Kind != c.Kind || c.InputHash != c.CatalogRef {
				t.Fatalf("%s catalog identity mismatch", c.ID)
			}
			if seen[c.CatalogRef] {
				t.Fatalf("duplicate catalog input %s", c.CatalogRef)
			}
			seen[c.CatalogRef] = true
		}
		if c.Kind == "synthetic" {
			if c.AST != nil || c.Diagnostics != nil || c.Reason == "" {
				t.Fatalf("%s must explicitly omit AST/diagnostics", c.ID)
			}
			continue
		}
		if c.Kind != "project" || c.Directory != c.ID {
			t.Fatalf("invalid project directory: %+v", c)
		}
		directories[c.Directory] = true
		files := readHIRSources(t, filepath.Join(hirProjectsRoot, c.Directory, "source"))
		if len(files) != len(c.SourceHashes) {
			t.Fatalf("%s source inventory mismatch", c.ID)
		}
		for name, source := range files {
			sum := sha256.Sum256([]byte(source))
			if hex.EncodeToString(sum[:]) != c.SourceHashes[name] {
				t.Fatalf("%s/%s original bytes changed", c.ID, name)
			}
		}
		if c.CatalogRef != "" && !reflect.DeepEqual(files, catalog[c.CatalogRef].Files) {
			t.Fatalf("%s no longer matches captured input bytes", c.ID)
		}
		if c.Diagnostics == nil || *c.Diagnostics != "diagnostics.json" || (c.AST != nil && *c.AST != "ast.golden") {
			t.Fatalf("invalid golden paths: %s", c.ID)
		}
	}
	if len(seen) != len(catalog) {
		t.Fatalf("catalog coverage %d/%d", len(seen), len(catalog))
	}
	entries, err := os.ReadDir(hirProjectsRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() && !directories[entry.Name()] {
			t.Fatalf("unregistered project directory %s", entry.Name())
		}
	}
	examples, err := os.ReadDir("../../examples")
	if err != nil {
		t.Fatal(err)
	}
	for _, example := range examples {
		if !example.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join("../../examples", example.Name(), "Ballerina.toml")); os.IsNotExist(err) {
			continue
		}
		id := "example-" + example.Name()
		if !ids[id] {
			t.Fatalf("example %s lacks AST corpus coverage", example.Name())
		}
		if !reflect.DeepEqual(exampleFiles(t, example.Name()), readHIRSources(t, filepath.Join(hirProjectsRoot, id, "source"))) {
			t.Fatalf("example %s differs from archived original inputs", example.Name())
		}
	}
}

// TestHIRSourceInventory is deliberately independent of the frozen render catalog.
// Recipes reconstruct requests from current Go AST literals, including table cases
// and successive edits, rather than trusting copies of captured render inputs.
func TestHIRSourceInventory(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(hirProjectsRoot, "source-inventory.json"))
	if err != nil {
		t.Fatal(err)
	}
	var inventory struct {
		Native []struct {
			File      string `json:"file"`
			SHA256    string `json:"sha256"`
			Scenarios []struct {
				Name      string `json:"name"`
				Exclusion string `json:"exclusion"`
				Requests  []struct {
					Project        string           `json:"project"`
					Example        string           `json:"example"`
					Literals       map[string][]int `json:"literals"`
					ManifestPrefix []string         `json:"manifestPrefix"`
				} `json:"requests"`
			} `json:"scenarios"`
		} `json:"native"`
	}
	if err := json.Unmarshal(data, &inventory); err != nil {
		t.Fatal(err)
	}
	registered := map[string]bool{}
	for _, entry := range inventory.Native {
		path := filepath.Join("../..", entry.File)
		if registered[path] {
			t.Fatalf("duplicate inventory file %s", path)
		}
		registered[path] = true
		source, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(source)
		if hex.EncodeToString(sum[:]) != entry.SHA256 {
			t.Fatalf("original test changed: %s; explicitly audit source inventory, never silently refresh its hash", path)
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, source, 0)
		if err != nil {
			t.Fatal(err)
		}
		functions := map[string][]string{}
		for _, declaration := range parsed.Decls {
			fn, ok := declaration.(*ast.FuncDecl)
			if !ok || !strings.HasPrefix(fn.Name.Name, "Test") {
				continue
			}
			literals := []string{}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				if literal, ok := node.(*ast.BasicLit); ok && literal.Kind == token.STRING {
					value, err := strconv.Unquote(literal.Value)
					if err != nil {
						t.Fatal(err)
					}
					literals = append(literals, value)
				}
				return true
			})
			functions[fn.Name.Name] = literals
		}
		for _, scenario := range entry.Scenarios {
			literals, ok := functions[scenario.Name]
			if !ok {
				t.Fatalf("unknown/duplicate scenario %s/%s", path, scenario.Name)
			}
			delete(functions, scenario.Name)
			if len(scenario.Requests) == 0 && scenario.Exclusion == "" {
				t.Fatalf("unclassified scenario %s", scenario.Name)
			}
			for _, request := range scenario.Requests {
				files := project("")
				if request.Example != "" {
					files = exampleFiles(t, request.Example)
				}
				for name, indices := range request.Literals {
					var source strings.Builder
					for _, index := range indices {
						if index < 0 || index >= len(literals) {
							t.Fatalf("bad literal index %s/%d", scenario.Name, index)
						}
						source.WriteString(literals[index])
					}
					files[name] = source.String()
				}
				for _, name := range request.ManifestPrefix {
					files[name] = manifest + files[name]
				}
				archived := readHIRSources(t, filepath.Join(hirProjectsRoot, request.Project, "source"))
				if !reflect.DeepEqual(files, archived) {
					t.Fatalf("%s/%s request %s differs from current original source definitions", path, scenario.Name, request.Project)
				}
			}
		}
		if len(functions) != 0 {
			t.Fatalf("uninventoried native scenarios in %s: %v", path, functions)
		}
	}
	paths, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if strings.HasPrefix(path, "hir") {
			continue
		} // HIR's own contract tests are not the pre-HIR source baseline.
		if !registered[filepath.Join("..", "..", "packages", "compiler", path)] {
			t.Fatalf("uninventoried native test file %s", path)
		}
	}
	// Babel performs static browser request extraction, never eval.
	output, err := exec.Command("node", "../../scripts/update_hir_goldens.mjs", "--check-inventory").CombinedOutput()
	if err != nil {
		t.Fatalf("browser source inventory: %v\n%s", err, output)
	}
}

func TestHIRProjects(t *testing.T) {
	for _, c := range readHIRCorpus(t) {
		if c.Kind == "project" {
			t.Run(c.ID, func(t *testing.T) { runHIRCase(t, c.Directory, *updateHIRGoldens) })
		}
	}
}

// runHIRCase resolves once and compares the actual frontend before any lowering.
// Stage 4 adds direct HIR lowering/validation here; no AST-shaped HIR is fabricated.
func runHIRCase(t *testing.T, directory string, update bool) {
	t.Helper()
	if filepath.Base(directory) != directory || directory == "." || directory == ".." {
		t.Fatal("unsafe corpus directory")
	}
	root := filepath.Join(hirProjectsRoot, directory)
	files := readHIRSources(t, filepath.Join(root, "source"))
	program, items, err := resolveProgram(files)
	if err != nil {
		t.Fatalf("frontend infrastructure error: %v", err)
	}
	if items == nil {
		items = []Diagnostic{}
	}
	diagnostics, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	compareHIRGolden(t, root, "diagnostics.json", append(diagnostics, '\n'), update)
	invalid := false
	for _, item := range items {
		if item.Severity == Error || item.Severity == Fatal || item.Severity == Internal {
			invalid = true
		}
	}
	if invalid {
		if program != nil {
			t.Fatal("invalid source returned a resolved program")
		}
		if _, err := os.Stat(filepath.Join(root, "ast.golden")); !os.IsNotExist(err) {
			t.Fatal("invalid input must not have an AST golden (remove stale golden explicitly)")
		}
		if !update {
			for _, c := range readHIRCorpus(t) {
				if c.Directory == directory && c.AST != nil {
					t.Fatal("invalid fixture must explicitly declare ast: null")
				}
			}
		}
		return
	}
	if program == nil {
		t.Fatal("frontend returned neither a program nor source errors")
	}
	if !update {
		for _, c := range readHIRCorpus(t) {
			if c.Directory == directory && c.AST == nil {
				t.Fatal("valid fixture must declare its AST expectation")
			}
		}
	}
	frontend, err := printFrontend(program)
	if err != nil {
		t.Fatal(err)
	}
	compareHIRGolden(t, root, "ast.golden", []byte(frontend), update)
	// Printing must not mutate either resolved input or the provenance snapshots.
	again, err := printFrontend(program)
	if err != nil || again != frontend {
		t.Fatalf("frontend printing is nondeterministic: %v", err)
	}
}

func TestHIRFrontendInputOrder(t *testing.T) {
	for _, directory := range []string{"example-definitions-and-calls", "example-source-ranges", "targeted-provenance"} {
		t.Run(directory, func(t *testing.T) {
			files := readHIRSources(t, filepath.Join(hirProjectsRoot, directory, "source"))
			names := make([]string, 0, len(files))
			for name := range files {
				names = append(names, name)
			}
			sort.Sort(sort.Reverse(sort.StringSlice(names)))
			reordered := Files{}
			for _, name := range names {
				reordered[name] = files[name]
			}
			first, items, err := resolveProgram(files)
			if err != nil || first == nil {
				t.Fatalf("%v: %+v", err, items)
			}
			second, items, err := resolveProgram(reordered)
			if err != nil || second == nil {
				t.Fatalf("%v: %+v", err, items)
			}
			a, err := printFrontend(first)
			if err != nil {
				t.Fatal(err)
			}
			b, err := printFrontend(second)
			if err != nil {
				t.Fatal(err)
			}
			if a != b {
				t.Fatal("reordered project input changed frontend dump")
			}
		})
	}
}

func compareHIRGolden(t *testing.T, root, name string, actual []byte, update bool) {
	t.Helper()
	// Hard allow-list: even explicit update can never write render SVG/HTML files.
	if name != "ast.golden" && name != "diagnostics.json" {
		t.Fatalf("not an AST/diagnostics golden: %s", name)
	}
	path := filepath.Join(root, name)
	if update {
		if err := os.WriteFile(path, actual, 0644); err != nil {
			t.Fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v; update explicitly with npm run test:hir:update", path, err)
	}
	if bytes.Equal(expected, actual) {
		return
	}
	temporary := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(temporary, actual, 0600); err != nil {
		t.Fatal(err)
	}
	diff, _ := exec.Command("diff", "-u", path, temporary).CombinedOutput()
	if len(diff) == 0 {
		diff = []byte(fmt.Sprintf("expected %d bytes; actual %d bytes", len(expected), len(actual)))
	}
	t.Fatalf("%s differs (npm run test:hir:update to accept intentionally):\n%s", path, diff)
}

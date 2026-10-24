package compiler

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
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

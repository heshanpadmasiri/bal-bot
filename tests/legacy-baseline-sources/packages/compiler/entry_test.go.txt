package compiler

import (
	"reflect"
	"strings"
	"testing"
)

func TestFunctionEntrySourceMetadata(t *testing.T) {
	source := `import ballerina/http;
service /orders on new http:Listener(8080) {
    resource function get [int id](boolean includeItems = false) returns string { _ = id; _ = includeItems; return "order"; }
    remote function refresh(string note = "") returns boolean { _ = note; return true; }
}
class PricingEngine {
    function quote(decimal subtotal) returns decimal { return subtotal; }
}
function calculateTax(decimal amount, decimal rate = 0.15) returns decimal { return amount * rate; }
function identity(int value) returns int => value;
public function main() {}
`
	result, err := Analyze(project(source))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != "valid" {
		t.Fatalf("invalid source: %+v", result.Diagnostics)
	}
	expected := map[string]FunctionEntryModel{
		"get /[int id]":       {Kind: "resource", Name: "get /[int id]", Signature: "resource function get [int id](boolean includeItems = false) returns string", Parameters: []FunctionParameterModel{{Kind: "path", Text: "[int id]"}, {Kind: "input", Text: "boolean includeItems = false"}}, ReturnType: "string"},
		"refresh":             {Kind: "remote", Name: "refresh", Signature: `remote function refresh(string note = "") returns boolean`, Parameters: []FunctionParameterModel{{Kind: "input", Text: `string note = ""`}}, ReturnType: "boolean"},
		"PricingEngine.quote": {Kind: "method", Name: "PricingEngine.quote", Signature: "function quote(decimal subtotal) returns decimal", Parameters: []FunctionParameterModel{{Kind: "input", Text: "decimal subtotal"}}, ReturnType: "decimal"},
		"calculateTax":        {Kind: "function", Name: "calculateTax", Signature: "function calculateTax(decimal amount, decimal rate = 0.15) returns decimal", Parameters: []FunctionParameterModel{{Kind: "input", Text: "decimal amount"}, {Kind: "input", Text: "decimal rate = 0.15"}}, ReturnType: "decimal"},
		"main":                {Kind: "function", Name: "main", Signature: "public function main()", Parameters: []FunctionParameterModel{}, ReturnType: "()"},
	}
	for _, fn := range result.Program.Functions {
		if want, ok := expected[fn.Entry.Name]; ok {
			if !reflect.DeepEqual(fn.Entry, want) {
				t.Errorf("%s: got %+v; want %+v", fn.ID, fn.Entry, want)
			}
			delete(expected, fn.Entry.Name)
		}
		if strings.Contains(fn.Entry.Signature, "=>") || strings.Contains(fn.Entry.Signature, "return subtotal;") {
			t.Errorf("body leaked into signature: %q", fn.Entry.Signature)
		}
	}
	if len(expected) > 0 {
		t.Fatalf("missing entries: %+v", expected)
	}
}

package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

// The adapter's exported model and stop point are not upstream compiler behavior.
func TestAnalyzeExamples(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"service-discovery", "automation-flow", "definitions-and-calls", "control-flow", "function-expansion", "source-ranges", "analysis-recovery", "chat-references", "panel-state", "unsupported-constructs", "design-critique"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			result, err := Analyze(exampleFiles(t, name))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != "valid" {
				t.Fatalf("%+v", result.Diagnostics)
			}
			if len(result.Program.Scopes) == 0 {
				t.Fatal("missing scopes")
			}
			data, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), `"body":null`) {
				t.Fatal("null body")
			}
			if name == "service-discovery" {
				if len(result.Program.Scopes) != 3 {
					t.Fatalf("services: %+v", result.Program.Scopes)
				}
				remoteTitles := []string{}
				for _, scope := range result.Program.Scopes {
					for _, endpoint := range *scope.Endpoints {
						if endpoint.Kind == "remote" {
							remoteTitles = append(remoteTitles, endpoint.Title)
						}
					}
				}
				if strings.Join(remoteTitles, ",") != "onBytes,refresh" {
					t.Fatalf("remote display titles: %v", remoteTitles)
				}
			}
			if name == "automation-flow" && result.Program.Scopes[0].Kind != "automation" {
				t.Fatal("not Automation")
			}
		})
	}
}
func TestAnalyzeInvalidInput(t *testing.T) {
	t.Parallel()
	for _, files := range []Files{nil, {}, {"main.bal": ""}, project("public function main( {"), project("public function main() { int x = true + 2; _ = x; }"), {"Ballerina.toml": manifest, "tests/test.bal": ""}} {
		result, err := Analyze(files)
		if err != nil || result.Kind != "invalid" || len(result.Diagnostics) == 0 || result.Program != nil {
			t.Fatalf("files=%v: %+v %v", files, result, err)
		}
	}
}

func TestAnalysisIsNotFullChecking(t *testing.T) {
	t.Parallel()
	files := project("public function main() { int x = \"bad\"; _ = x; }")
	analysis, err := Analyze(files)
	if err != nil || analysis.Kind != "valid" {
		t.Fatalf("local resolution: %+v %v", analysis, err)
	}
	checked, err := Check(files)
	if err != nil || len(checked.Diagnostics) == 0 {
		t.Fatalf("full checking: %+v %v", checked, err)
	}
}

func TestResolvedDiscoveryAndTargets(t *testing.T) {
	t.Parallel()
	result, err := Analyze(exampleFiles(t, "definitions-and-calls"))
	if err != nil {
		t.Fatal(err)
	}
	scope := result.Program.Scopes[0]
	kinds := map[string]string{}
	for _, def := range *scope.Definitions {
		kinds[def.Label] = def.Kind
	}
	for _, name := range []string{"calculate", "unusedHelper"} {
		if kinds[name] != "function" {
			t.Fatalf("missing module function %s", name)
		}
	}
	if kinds["UnusedRecord"] != "type" || kinds["upstreamClient"] != "connector" {
		t.Fatalf("definitions: %+v", kinds)
	}
	endpoint := (*scope.Endpoints)[0]
	body := result.Program.Functions[endpoint.FunctionID].Body
	local := (*body[0].Calls)[0]
	remote := (*body[1].Calls)[0]
	if local.Target.FunctionID == remote.Target.FunctionID {
		t.Fatal("same-name functions were conflated")
	}
	if result.Program.Functions[local.Target.FunctionID].Source.File != "helpers.bal" || result.Program.Functions[remote.Target.FunctionID].Source.File != "modules/math/calculate.bal" {
		t.Fatal("wrong resolved source targets")
	}
	for _, def := range *scope.Definitions {
		if def.Label == "unusedHelper" {
			call := (*result.Program.Functions[def.FunctionID].Body[0].Calls)[0]
			if call.Target.Kind != "workspace" || result.Program.Functions[call.Target.FunctionID].Source.File != "main.bal" {
				t.Fatalf("workspace client method misclassified: %+v", call)
			}
		}
	}
	files := exampleFiles(t, "definitions-and-calls")
	files["unrelated.bal"] = "// harmless new file\n"
	edited, err := Analyze(files)
	if err != nil {
		t.Fatal(err)
	}
	if edited.Program.Scopes[0].ID != scope.ID {
		t.Fatal("harmless edit changed service identity")
	}
}
func TestRangesAndSupportedBlocks(t *testing.T) {
	t.Parallel()
	result, err := Analyze(exampleFiles(t, "source-ranges"))
	if err != nil {
		t.Fatal(err)
	}
	main := result.Program.Functions[result.Program.Scopes[0].FunctionID]
	declaration := main.Body[0]
	if declaration.Text != "string greeting = \"Hello 🚀 café\";" || declaration.Source.Range.Start != (Position{3, 5}) {
		t.Fatalf("Unicode source: %+v", declaration)
	}
	found := false
	for _, fn := range result.Program.Functions {
		if fn.Source.File == "windows.bal" {
			found = true
			if !strings.Contains(fn.Text, "\r\n") {
				t.Fatal("CRLF source normalized")
			}
			if fn.Body[0].Source.Range.Start != (Position{2, 5}) {
				t.Fatalf("CRLF range: %+v", fn.Body[0])
			}
		}
	}
	if !found {
		t.Fatal("missing cross-file function")
	}
	design, err := Analyze(exampleFiles(t, "design-critique"))
	if err != nil {
		t.Fatal(err)
	}
	var inspect func([]StatementModel)
	inspect = func(body []StatementModel) {
		for _, s := range body {
			if s.Kind == "unsupported" {
				t.Fatalf("supported source became limited: %s: %s", s.Text, s.Reason)
			}
			if s.Body != nil {
				inspect(*s.Body)
			}
			if s.ThenBody != nil {
				inspect(*s.ThenBody)
			}
			if s.ElseBody != nil {
				inspect(*s.ElseBody)
			}
		}
	}
	for _, fn := range design.Program.Functions {
		inspect(fn.Body)
	}
}

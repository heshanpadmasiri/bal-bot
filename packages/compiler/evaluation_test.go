package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestClientCallAndTemplate(t *testing.T) {
	result, err := Analyze(project("import ballerina/http;\ntype Person record {| string first_name; string last_name; |};\nfinal http:Client testClient = check new (\"https://test.com\");\nservice / on new http:Listener(8080) { resource function get hello() returns string|error { Person person = check testClient->get(\"/foo/bar\"); return string `hello ${person.first_name} ${person.last_name}`; } }"))
	if err != nil || result.Kind != "valid" {
		data, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("%s %v", data, err)
	}
	endpoint := (*result.Program.Scopes[0].Endpoints)[0]
	body := result.Program.Functions[endpoint.FunctionID].Body
	if body[0].Kind != "simple" || body[0].Binding != "Person person" || body[0].Evaluation == nil {
		t.Fatalf("call: %+v", body[0])
	}
	e := body[0].Evaluation
	if e.Kind != "check" || len(e.Children) != 1 || e.Children[0].Call == nil {
		t.Fatalf("evaluation: %+v", e)
	}
	c := e.Children[0].Call.Client
	if c == nil || c.Context.Type != "http:Client" || c.Context.Origin != "constructor" || c.Context.Initializer.Text != `check new ("https://test.com")` || c.Method != "get" || c.Arguments[0].Text != `"/foo/bar"` {
		t.Fatalf("client: %+v", c)
	}
	template := body[1].Evaluation
	if template == nil || template.Kind != "template" || len(template.Children) != 2 || template.Children[0].Text != "person.first_name" || strings.Join(template.Strings, "|") != "hello | |" {
		t.Fatalf("template: %+v", template)
	}
}

func TestGenericClientContexts(t *testing.T) {
	source := `client class Queue {
   public function init(string host, int port = 12) { _ = host; _ = port; }
   remote function send(string message, string topic = "jobs") returns string|error { return topic + message; }
 }
 final Queue globalQueue = new ("host", port = 99);
 function makeQueue() returns Queue { return new ("factory"); }
 function run(Queue inputQueue) returns error? {
   string first = check globalQueue->send("one", topic = "orders");
   Queue local = makeQueue();
   string second = check local->send("two");
   local = new ("replacement");
   string third = check local->send("three");
   string fourth = check inputQueue->send("four");
 _ = first; _ = second; _ = third; _ = fourth;
   { Queue globalQueue = new ("shadow"); string fifth = check globalQueue->send("five"); _ = fifth; }
 }
 public function main() {}`
	result, err := Analyze(project(source))
	if err != nil || result.Kind != "valid" {
		data, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("%s %v", data, err)
	}
	var body []StatementModel
	for _, f := range result.Program.Functions {
		if f.Entry.Name == "run" {
			body = f.Body
		}
	}
	if len(body) != 13 {
		t.Fatalf("body: %+v", body)
	}
	client := func(index int) *ClientInvocationModel {
		t.Helper()
		e := body[index].Evaluation
		if e == nil || len(e.Children) != 1 || e.Children[0].Call == nil {
			t.Fatalf("evaluation: %+v", e)
		}
		return e.Children[0].Call.Client
	}
	global := client(0)
	if global == nil || global.Method != "send" || global.Arguments[1].Text != `topic = "orders"` || global.Context.Initializer.Text != `new ("host", port = 99)` {
		t.Fatalf("global: %+v", global)
	}
	for _, i := range []int{2, 4} {
		if c := client(i); c.Context.Origin != "unavailable" || c.Context.Initializer != nil {
			t.Fatalf("reassigned context: %+v", c)
		}
	}
	if c := client(5); c.Context.Origin != "parameter" {
		t.Fatalf("parameter: %+v", c)
	}
	if c := client(11); c.Context.Initializer.Text != `new ("shadow")` {
		t.Fatalf("shadow: %+v", c)
	}
}

func TestNestedErrorOperators(t *testing.T) {
	result, err := Analyze(project(`function risky() returns int|error { return 1; }
 public function main() returns error? {
   int|error captured = trap checkpanic risky();
   int checked = check (trap risky());
   string message = string ` + "`value ${check risky()}`" + `;
 _ = captured; _ = checked; _ = message;
 }`))
	if err != nil || result.Kind != "valid" {
		data, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("%s %v", data, err)
	}
	for _, f := range result.Program.Functions {
		if f.Entry.Name != "main" {
			continue
		}
		b := f.Body
		if b[0].Evaluation.Kind != "trap" || b[0].Evaluation.Children[0].Kind != "checkpanic" || b[1].Evaluation.Kind != "check" || b[1].Evaluation.Children[0].Kind != "trap" || b[2].Evaluation.Children[0].Kind != "check" {
			t.Fatalf("operator nesting: %+v", b)
		}
	}
}

func TestClientAssignmentRetainsComputedTarget(t *testing.T) {
	result, err := Analyze(project(`client class Queue {
 remote function read() returns string|error { return "value"; }
 }
 function index() returns int { return 0; }
 function fill(Queue queue, string[] values) returns error? {
 values[index()] = check queue->read();
 }
 public function main() {}`))
	if err != nil || result.Kind != "valid" {
		data, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("%s %v", data, err)
	}
	for _, fn := range result.Program.Functions {
		if fn.Entry.Name != "fill" {
			continue
		}
		s := fn.Body[0]
		if s.Evaluation == nil || len(s.Evaluation.Children) != 2 || s.Evaluation.Children[0].Children[0].Call.Target.Kind != "workspace" || s.Evaluation.Children[1].Kind != "check" || s.Binding != "values[index()]" {
			t.Fatalf("assignment: %+v", s)
		}
	}
}

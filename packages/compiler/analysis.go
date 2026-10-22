package compiler

import (
	"fmt"
	"slices"
	"strings"

	"github.com/ballerina-nutcracker/ballerina/ast"
	"github.com/ballerina-nutcracker/ballerina/model"
	"github.com/ballerina-nutcracker/ballerina/semtypes"
	"github.com/ballerina-nutcracker/ballerina/tools/diagnostics"
)

type SourceReferenceModel struct {
	File  string      `json:"file"`
	Range SourceRange `json:"range"`
}
type LocatedModel struct {
	ID     string               `json:"id"`
	Source SourceReferenceModel `json:"source"`
	Text   string               `json:"text"`
}
type CallTargetModel struct {
	Kind       string `json:"kind"`
	FunctionID string `json:"functionId,omitempty"`
	Label      string `json:"label,omitempty"`
}
type CallSiteModel struct {
	LocatedModel
	Target    CallTargetModel `json:"target"`
	Expansion string          `json:"expansion"`
	Reason    string          `json:"reason,omitempty"`
}
type ExpressionModel struct {
	LocatedModel
	Calls []CallSiteModel `json:"calls"`
}
type StatementModel struct {
	LocatedModel
	Kind         string            `json:"kind"`
	Operation    string            `json:"operation,omitempty"`
	Presentation string            `json:"presentation,omitempty"`
	Calls        *[]CallSiteModel  `json:"calls,omitempty"`
	Condition    *ExpressionModel  `json:"condition,omitempty"`
	Header       *ExpressionModel  `json:"header,omitempty"`
	ThenBody     *[]StatementModel `json:"thenBody,omitempty"`
	ElseBody     *[]StatementModel `json:"elseBody,omitempty"`
	Body         *[]StatementModel `json:"body,omitempty"`
	Reason       string            `json:"reason,omitempty"`
}
type FunctionModel struct {
	LocatedModel
	ModuleID string           `json:"moduleId"`
	Body     []StatementModel `json:"body"`
}
type DefinitionModel struct {
	LocatedModel
	Kind       string `json:"kind"`
	Label      string `json:"label"`
	FunctionID string `json:"functionId,omitempty"`
}
type EndpointModel struct {
	LocatedModel
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	FunctionID string `json:"functionId"`
}
type ScopeModel struct {
	LocatedModel
	Kind        string             `json:"kind"`
	Title       string             `json:"title"`
	ModuleID    string             `json:"moduleId"`
	ServiceType *string            `json:"serviceType"`
	FunctionID  string             `json:"functionId,omitempty"`
	Endpoints   *[]EndpointModel   `json:"endpoints,omitempty"`
	Definitions *[]DefinitionModel `json:"definitions,omitempty"`
}
type ProgramModel struct {
	Scopes    []ScopeModel             `json:"scopes"`
	Functions map[string]FunctionModel `json:"functions"`
}
type AnalysisResult struct {
	Kind        string        `json:"kind"`
	Program     *ProgramModel `json:"program,omitempty"`
	Diagnostics []Diagnostic  `json:"diagnostics"`
}

// Analyze resolves saved workspace source without semantic analysis or desugaring.
func Analyze(files Files) (result AnalysisResult, err error) {
	defer func() {
		if p := recover(); p != nil {
			result = AnalysisResult{}
			err = fmt.Errorf("analysis extraction panic: %v", p)
		}
	}()
	program, items, err := resolveProgram(files)
	if err != nil {
		return AnalysisResult{}, err
	}
	if items == nil {
		items = []Diagnostic{}
	}
	for _, item := range items {
		if item.Severity == Error || item.Severity == Fatal || item.Severity == Internal {
			return AnalysisResult{Kind: "invalid", Diagnostics: items}, nil
		}
	}
	if program == nil {
		return AnalysisResult{}, fmt.Errorf("resolution returned no program without an error diagnostic")
	}
	exported, err := extractProgram(program)
	if err != nil {
		return AnalysisResult{}, err
	}
	return AnalysisResult{Kind: "valid", Program: &exported, Diagnostics: items}, nil
}

func sourceReference(files Files, env *diagnostics.DiagnosticEnv, location diagnostics.Location) (SourceReferenceModel, error) {
	file := env.FileName(location)
	text, exists := files[file]
	if !exists || !diagnostics.LocationHasSource(location) {
		return SourceReferenceModel{}, fmt.Errorf("missing workspace source for %q", file)
	}
	if location.EndOffset() < location.StartOffset() {
		return SourceReferenceModel{}, fmt.Errorf("reversed source range in %q", file)
	}
	start, err := position(text, location.StartOffset())
	if err != nil {
		return SourceReferenceModel{}, err
	}
	end, err := position(text, location.EndOffset())
	if err != nil {
		return SourceReferenceModel{}, err
	}
	return SourceReferenceModel{File: file, Range: SourceRange{Start: start, End: end}}, nil
}

func (p *resolvedProgram) located(id string, node ast.Node) LocatedModel {
	location := node.GetPosition()
	ref, err := sourceReference(p.files, p.env.DiagnosticEnv(), location)
	if err != nil {
		panic(err)
	}
	return LocatedModel{ID: id, Source: ref, Text: p.files[ref.File][location.StartOffset():location.EndOffset()]}
}

type sourceFunction interface {
	ast.InvokableNode
	Symbol() model.SymbolRef
	IsAttached() bool
}

type extractionFunction struct {
	node         sourceFunction
	moduleID, id string
}

func extractProgram(p *resolvedProgram) (ProgramModel, error) {
	result := ProgramModel{Scopes: []ScopeModel{}, Functions: map[string]FunctionModel{}}
	p.functionIDs = map[model.SymbolRef]string{}
	p.availableBodies = map[string]bool{}
	var functions []extractionFunction
	addFunction := func(fn sourceFunction, moduleID, id string) {
		p.functionIDs[fn.Symbol()] = id
		switch fn.GetBody().(type) {
		case *ast.BLangBlockFunctionBody, *ast.BLangExprFunctionBody:
			p.availableBodies[id] = true
		}
		functions = append(functions, extractionFunction{fn, moduleID, id})
	}
	// Collect definition identities before resolving any call sites.
	serviceIDs := map[*ast.BLangService]string{}
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		moduleID := mod.module.Descriptor().Org().Value() + "/" + mod.module.ModuleName().String()
		for _, fn := range mod.pkg.Functions {
			addFunction(fn, moduleID, moduleID+"/function/"+fn.Name.GetValue())
		}
		for _, class := range mod.pkg.ClassDefinitions {
			names := []string{}
			for name := range class.Methods {
				names = append(names, name)
			}
			slices.Sort(names)
			for _, name := range names {
				addFunction(class.Methods[name], moduleID, moduleID+"/class/"+class.Name.GetValue()+"/method/"+name)
			}
			for _, fn := range class.ResourceMethods {
				addFunction(fn, moduleID, moduleID+"/class/"+class.Name.GetValue()+"/resource/"+resourceSignature(p, fn))
			}
		}
		counts := map[string]int{}
		for _, service := range mod.pkg.Services {
			loc := service.GetPosition()
			path := servicePath(service)
			key := moduleID + "/service/" + p.env.DiagnosticEnv().FileName(loc) + "/" + path
			counts[key]++
			id := fmt.Sprintf("%s/%d", key, counts[key])
			serviceIDs[service] = id
			names := make([]string, 0, len(service.Methods))
			for name := range service.Methods {
				names = append(names, name)
			}
			slices.Sort(names)
			for _, name := range names {
				addFunction(service.Methods[name], moduleID, id+"/method/"+name)
			}
			for _, fn := range service.ResourceMethods {
				addFunction(fn, moduleID, id+"/resource/"+resourceSignature(p, fn))
			}
		}
	}
	for _, fn := range functions {
		var body []StatementModel
		switch node := fn.node.GetBody().(type) {
		case *ast.BLangBlockFunctionBody:
			var err error
			body, err = extractStatements(p, fn.id, node.Stmts)
			if err != nil {
				return ProgramModel{}, err
			}
		case *ast.BLangExprFunctionBody:
			stmt := StatementModel{LocatedModel: p.located(fn.id+"/expression", node.Expr), Kind: "return"}
			calls, reason := p.expressionCalls(stmt.ID, node.Expr, true)
			if reason != "" {
				stmt.Kind = "unsupported"
				stmt.Reason = reason
			} else {
				stmt.Calls = &calls
			}
			body = []StatementModel{stmt}
		default:
			body = []StatementModel{{LocatedModel: p.located(fn.id+"/body", fn.node), Kind: "unsupported", Reason: "Function body is unavailable for visualization."}}
		}
		result.Functions[fn.id] = FunctionModel{LocatedModel: p.located(fn.id, fn.node), ModuleID: fn.moduleID, Body: body}
	}
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		moduleID := mod.module.Descriptor().Org().Value() + "/" + mod.module.ModuleName().String()
		definitions := []DefinitionModel{}
		for _, fn := range mod.pkg.Functions {
			id := p.functionIDs[fn.Symbol()]
			definitions = append(definitions, DefinitionModel{LocatedModel: p.located(id, fn), Kind: "function", Label: fn.Name.GetValue(), FunctionID: id})
		}
		for _, ty := range mod.pkg.TypeDefinitions {
			definitions = append(definitions, DefinitionModel{LocatedModel: p.located(moduleID+"/type/"+ty.Name.GetValue(), ty), Kind: "type", Label: ty.Name.GetValue()})
		}
		typeContext := semtypes.ContextFrom(p.env.GetTypeEnv())
		connector := func(v *ast.BLangVariable, owner string) (DefinitionModel, bool) {
			if semtypes.IsClientObject(typeContext, p.env.SymbolType(v.Symbol())) {
				return DefinitionModel{LocatedModel: p.located(owner+"/connector/"+v.Name.GetValue(), v), Kind: "connector", Label: v.Name.GetValue()}, true
			}
			return DefinitionModel{}, false
		}
		for _, v := range mod.pkg.GlobalVars {
			if d, ok := connector(v, moduleID); ok {
				definitions = append(definitions, d)
			}
		}
		for _, service := range mod.pkg.Services {
			id := serviceIDs[service]
			defs := append([]DefinitionModel{}, definitions...)
			endpoints := []EndpointModel{}
			names := []string{}
			for name := range service.Methods {
				names = append(names, name)
			}
			slices.Sort(names)
			path := servicePath(service)
			for _, name := range names {
				fn := service.Methods[name]
				fid := p.functionIDs[fn.Symbol()]
				if fn.IsRemote() {
					endpoints = append(endpoints, EndpointModel{LocatedModel: p.located(fid, fn), Kind: "remote", Title: name, FunctionID: fid})
				} else {
					defs = append(defs, DefinitionModel{LocatedModel: p.located(fid, fn), Kind: "function", Label: name, FunctionID: fid})
				}
			}
			for _, fn := range service.ResourceMethods {
				fid := p.functionIDs[fn.Symbol()]
				title := fn.Name.GetValue() + " " + strings.TrimRight(path, "/") + "/" + resourcePath(p, fn)
				endpoints = append(endpoints, EndpointModel{LocatedModel: p.located(fid, fn), Kind: "resource", Title: title, FunctionID: fid})
			}
			for _, v := range service.Fields {
				if d, ok := connector(v, id); ok {
					defs = append(defs, d)
				}
			}
			var serviceType *string
			for _, expr := range service.AttachedExprs {
				if n, ok := expr.(*ast.BLangNewExpression); ok && !n.ClassSymbol.IsEmpty() {
					pkg := p.env.SymbolPackage(n.ClassSymbol)
					label := pkg.Organization + "/" + pkg.Package + ":" + p.env.SymbolName(n.ClassSymbol)
					serviceType = &label
					break
				}
			}
			title := path
			if title == "" {
				title = "Service"
				if serviceType != nil {
					title += " · " + *serviceType
				}
			}
			result.Scopes = append(result.Scopes, ScopeModel{LocatedModel: p.located(id, service), Kind: "service", Title: title, ModuleID: moduleID, ServiceType: serviceType, Endpoints: &endpoints, Definitions: &defs})
		}
	}
	if len(result.Scopes) == 0 {
		for _, fn := range functions {
			if fn.node.GetName().GetValue() == "main" && !fn.node.IsAttached() {
				result.Scopes = append(result.Scopes, ScopeModel{LocatedModel: p.located(fn.id, fn.node), Kind: "automation", Title: "Automation", ModuleID: fn.moduleID, FunctionID: fn.id})
			}
		}
	}
	slices.SortFunc(result.Scopes, func(a, b ScopeModel) int { return strings.Compare(a.ID, b.ID) })
	// Disambiguation changes labels, never the identity used by conversations.
	titles := map[string]int{}
	for _, scope := range result.Scopes {
		if scope.Kind == "service" {
			titles[scope.Title]++
		}
	}
	for i := range result.Scopes {
		scope := &result.Scopes[i]
		if scope.Kind == "service" && titles[scope.Title] > 1 {
			scope.Title += " · " + scope.ModuleID + " · " + scope.Source.File + fmt.Sprintf(":%d", scope.Source.Range.Start.Line)
		}
	}
	return result, nil
}
func servicePath(service *ast.BLangService) string {
	if service.AbsoluteResourcePath != nil {
		parts := []string{}
		for _, part := range service.AbsoluteResourcePath {
			parts = append(parts, part.Value)
		}
		return "/" + strings.Join(parts, "/")
	}
	if service.AttachPointLiteral != nil {
		return service.AttachPointLiteral.OriginalValue
	}
	return ""
}
func resourcePath(p *resolvedProgram, fn *ast.BLangResourceMethod) string {
	parts := []string{}
	for i := range fn.ResourcePath {
		parts = append(parts, p.located("path", &fn.ResourcePath[i]).Text)
	}
	return strings.Join(parts, "/")
}
func resourceSignature(p *resolvedProgram, fn *ast.BLangResourceMethod) string {
	return fn.Name.GetValue() + "/" + resourcePath(p, fn)
}

func extractStatements(p *resolvedProgram, functionID string, nodes []ast.StatementNode) ([]StatementModel, error) {
	result := make([]StatementModel, 0, len(nodes))
	for i, node := range nodes {
		id := fmt.Sprintf("%s/statement/%d", functionID, i)
		stmt := StatementModel{LocatedModel: p.located(id, node)}
		var expr ast.BLangActionOrExpression
		var lhs ast.BLangExpression
		switch n := node.(type) {
		case *ast.BLangBlockStmt:
			nested, err := extractStatements(p, id+"/block", n.Stmts)
			if err != nil {
				return nil, err
			}
			result = append(result, nested...)
			continue
		case *ast.BLangVariableDef:
			stmt.Kind = "simple"
			stmt.Operation = "declare"
			expr = n.Var.Expr
		case *ast.BLangAssignment:
			stmt.Kind = "simple"
			stmt.Operation = "assign"
			lhs = n.VarRef
			expr = n.Expr
		case *ast.BLangCompoundAssignment:
			stmt.Kind = "simple"
			stmt.Operation = "assign"
			lhs = n.VarRef
			expr = n.Expr
		case *ast.BLangExpressionStmt:
			stmt.Kind = "simple"
			stmt.Operation = "expression"
			expr = n.Expr
		case *ast.BLangReturn:
			stmt.Kind = "return"
			expr = n.Expr
		case *ast.BLangBreak:
			stmt.Kind = "break"
		case *ast.BLangContinue:
			stmt.Kind = "continue"
		case *ast.BLangIf:
			stmt.Kind = "if"
			condition := p.expression(id+"/condition", n.Expr, false)
			stmt.Condition = &condition
			then, _ := extractStatements(p, id+"/then", n.Body.Stmts)
			stmt.ThenBody = &then
			elseBody := []StatementModel{}
			if n.ElseStmt != nil {
				if block, ok := n.ElseStmt.(*ast.BLangBlockStmt); ok {
					elseBody, _ = extractStatements(p, id+"/else", block.Stmts)
				} else {
					elseBody, _ = extractStatements(p, id+"/else", []ast.StatementNode{n.ElseStmt})
				}
			}
			stmt.ElseBody = &elseBody
			if _, reason := p.expressionCalls(id, n.Expr, false); reason != "" {
				stmt = StatementModel{LocatedModel: stmt.LocatedModel, Kind: "unsupported", Reason: reason}
			}
		case *ast.BLangWhile:
			stmt.Kind = "while"
			condition := p.expression(id+"/condition", n.Expr, false)
			stmt.Condition = &condition
			body, _ := extractStatements(p, id+"/loop", n.Body.Stmts)
			stmt.Body = &body
			if _, reason := p.expressionCalls(id, n.Expr, false); reason != "" {
				stmt = StatementModel{LocatedModel: stmt.LocatedModel, Kind: "unsupported", Reason: reason}
			}
			if n.OnFailClause.Body != nil {
				stmt = StatementModel{LocatedModel: stmt.LocatedModel, Kind: "unsupported", Reason: "Loop on-fail behavior is not modeled."}
			}
		case *ast.BLangForeach:
			stmt.Kind = "foreach"
			header := p.expression(id+"/header", n.Collection, false)
			loc := n.VariableDef.GetPosition()
			end := n.Collection.GetPosition()
			loc = diagnostics.NewLocation(p.env.DiagnosticEnv(), header.Source.File, loc.StartOffset(), end.EndOffset())
			ref, err := sourceReference(p.files, p.env.DiagnosticEnv(), loc)
			if err != nil {
				return nil, err
			}
			header.Source = ref
			header.Text = p.files[ref.File][loc.StartOffset():loc.EndOffset()]
			stmt.Header = &header
			body, _ := extractStatements(p, id+"/loop", n.Body.Stmts)
			stmt.Body = &body
			if _, reason := p.expressionCalls(id, n.Collection, false); reason != "" {
				stmt = StatementModel{LocatedModel: stmt.LocatedModel, Kind: "unsupported", Reason: reason}
			}
			if n.OnFailClause != nil {
				stmt = StatementModel{LocatedModel: stmt.LocatedModel, Kind: "unsupported", Reason: "Loop on-fail behavior is not modeled."}
			}
		default:
			stmt.Kind = "unsupported"
			stmt.Reason = fmt.Sprintf("Visualization of %T is not modeled; later source may still execute.", node)
		}
		if stmt.Kind == "simple" || stmt.Kind == "return" {
			prefix, lhsReason := p.expressionCalls(id+"/lhs", lhs, false)
			calls, reason := p.expressionCalls(id, expr, len(prefix) == 0)
			calls = append(prefix, calls...)
			if lhsReason != "" {
				reason = lhsReason
			}
			if reason != "" {
				stmt.Kind = "unsupported"
				stmt.Operation = ""
				stmt.Reason = reason
			} else {
				stmt.Calls = &calls
				if stmt.Kind == "simple" {
					stmt.Presentation = "step"
					if _, ok := expr.(*ast.BLangMappingConstructorExpr); ok {
						stmt.Presentation = "mapping"
					}
				}
			}
		}
		result = append(result, stmt)
	}
	return result, nil
}
func (p *resolvedProgram) expression(id string, expr ast.BLangActionOrExpression, safe bool) ExpressionModel {
	calls, _ := p.expressionCalls(id, expr, safe)
	return ExpressionModel{LocatedModel: p.located(id, expr), Calls: calls}
}
func resolveCallTarget(p *resolvedProgram, call ast.Invocable) (CallTargetModel, error) {
	symbol := call.ResolvedSymbol()
	if symbol.IsEmpty() {
		return CallTargetModel{}, fmt.Errorf("unresolved invocation")
	}
	if id, ok := p.functionIDs[symbol]; ok {
		return CallTargetModel{Kind: "workspace", FunctionID: id}, nil
	}
	return CallTargetModel{Kind: "external", Label: p.env.SymbolName(symbol)}, nil
}

func (p *resolvedProgram) expressionCalls(id string, expr ast.BLangActionOrExpression, safe bool) ([]CallSiteModel, string) {
	calls := []CallSiteModel{}
	reason := ""
	var scan func(ast.BLangActionOrExpression, bool)
	scan = func(expr ast.BLangActionOrExpression, expand bool) {
		if expr == nil {
			return
		}
		if call, ok := expr.(ast.Invocable); ok {
			before := len(calls)
			if call.Receiver() != nil {
				scan(call.Receiver(), false)
			}
			for _, arg := range call.CallArgs() {
				scan(arg, false)
			}
			target, err := resolveCallTarget(p, call)
			if err != nil {
				panic(err)
			}
			site := CallSiteModel{LocatedModel: p.located(fmt.Sprintf("%s/call/%d", id, len(calls)), expr), Target: target, Expansion: "unavailable", Reason: "Expansion in this expression evaluation is not modeled."}
			if target.Kind == "external" {
				site.Reason = "The target is outside the workspace."
			} else if !p.availableBodies[target.FunctionID] {
				site.Reason = "The workspace function has no available source body."
			} else if expand && before == len(calls) {
				site.Expansion = "supported"
				site.Reason = ""
			}
			calls = append(calls, site)
			return
		}
		switch n := expr.(type) {
		case *ast.BLangLiteral, *ast.BLangNumericLiteral, *ast.BLangVarRef, *ast.BLangConstRef, *ast.BLangTypedescExpr, *ast.BLangWildCardBindingPattern:
		case *ast.BLangBinaryExpr:
			scan(n.LhsExpr, false)
			scan(n.RhsExpr, false)
		case *ast.BLangUnaryExpr:
			scan(n.Expr, false)
		case *ast.BLangTernaryExpr:
			scan(n.Condition, false)
			scan(n.ThenExpr, false)
			scan(n.ElseExpr, false)
		case *ast.BLangNilConditionalExpr:
			scan(n.LhsExpr, false)
			scan(n.RhsExpr, false)
		case *ast.BLangListConstructorExpr:
			for _, e := range n.Exprs {
				scan(e, false)
			}
		case *ast.BLangMappingConstructorExpr:
			for _, f := range n.Fields {
				if field, ok := f.(*ast.BLangMappingKeyValueField); ok {
					if field.Key != nil {
						scan(field.Key.Expr, false)
					}
					scan(field.ValueExpr, false)
				} else {
					reason = "Mapping field evaluation is not modeled."
				}
			}
		case *ast.BLangFieldBaseAccess:
			scan(n.Expr, false)
		case *ast.BLangIndexBasedAccess:
			scan(n.Expr, false)
			scan(n.IndexExpr, false)
		case *ast.BLangNamedArgsExpression:
			scan(n.Expr, false)
		case *ast.BLangNewExpression:
			for _, e := range n.ArgsExprs {
				scan(e, false)
			}
		case *ast.BLangTypeTestExpr:
			scan(n.Expr, false)
		default:
			reason = fmt.Sprintf("Control effects of %T are not modeled; later source may still execute.", expr)
		}
	}
	scan(expr, safe)
	return calls, reason
}

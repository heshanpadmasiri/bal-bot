package compiler

import (
	"fmt"
	"strings"

	"github.com/ballerina-nutcracker/ballerina/ast"
	"github.com/ballerina-nutcracker/ballerina/model"
	"github.com/ballerina-nutcracker/ballerina/semtypes"
)

// Symbol identity prevents shadowed clients from sharing constructor context. A
// mutable global or any reassigned receiver deliberately has no initializer hint.
func (p *resolvedProgram) collectReceiverContexts() {
	p.receiverContexts = map[model.SymbolRef]ReceiverContextModel{}
	written := map[model.SymbolRef]bool{}
	globals := map[model.SymbolRef]bool{}
	params := map[model.SymbolRef]bool{}
	var vars []*ast.BLangVariable
	for _, mod := range p.modules {
		if !mod.workspace {
			continue
		}
		for _, v := range mod.pkg.GlobalVars {
			globals[v.Symbol()] = true
		}
		ast.Walk(sourceVisitor(func(n ast.BLangNode) bool {
			if fn, ok := n.(ast.InvokableNode); ok {
				for _, v := range fn.GetParameters() {
					params[v.Symbol()] = true
				}
			}
			switch n := n.(type) {
			case *ast.BLangVariable:
				vars = append(vars, n)
			case *ast.BLangAssignment:
				if v, ok := n.VarRef.(*ast.BLangVarRef); ok {
					written[v.Symbol()] = true
				}
			case *ast.BLangCompoundAssignment:
				if v, ok := n.VarRef.(*ast.BLangVarRef); ok {
					written[v.Symbol()] = true
				}
			}
			return true
		}), mod.pkg)
	}
	for i, v := range vars {
		if v.Symbol().IsEmpty() {
			continue
		}
		context := ReceiverContextModel{Origin: "unavailable"}
		if ty := v.TypeNode(); ty != nil && !v.IsDeclaredWithVar {
			context.Type = p.located(fmt.Sprintf("receiver/%d/type", i), ty).Text
		}
		if params[v.Symbol()] {
			context.Origin = "parameter"
		}
		if !params[v.Symbol()] && v.Expr != nil && !written[v.Symbol()] && (!globals[v.Symbol()] || v.Flags()&model.FlagFinal != 0) {
			init := p.located(fmt.Sprintf("receiver/%d/initializer", i), v.Expr)
			context.Initializer = &init
			context.Origin = "initializer"
			expr := v.Expr
			for {
				switch n := expr.(type) {
				case *ast.BLangCheckedExpr:
					expr = n.Expr
				case *ast.BLangCheckPanickedExpr:
					expr = n.Expr
				case *ast.BLangGroupExpr:
					expr = n.Expression
				default:
					goto unwrapped
				}
			}
		unwrapped:
			if _, ok := expr.(*ast.BLangNewExpression); ok {
				context.Origin = "constructor"
			}
		}
		p.receiverContexts[v.Symbol()] = context
	}
}

func (p *resolvedProgram) clientInvocation(id string, call ast.Invocable) *ClientInvocationModel {
	receiver := call.Receiver()
	if receiver == nil {
		return nil
	}
	var context ReceiverContextModel
	isClient := false
	switch call.(type) {
	case *ast.BLangRemoteMethodCallAction, *ast.BLangClientResourceAccessAction:
		isClient = true
	}
	if ref, ok := receiver.(*ast.BLangVarRef); ok {
		context = p.receiverContexts[ref.Symbol()]
		if !ref.Symbol().IsEmpty() {
			isClient = isClient || semtypes.IsClientObject(semtypes.ContextFrom(p.env.GetTypeEnv()), p.env.SymbolType(ref.Symbol()))
		}
	}
	if !isClient {
		return nil
	}
	context.Receiver = p.located(id+"/receiver", receiver)
	if context.Origin == "" {
		context.Origin = "unavailable"
	}
	method := ""
	switch n := call.(type) {
	case *ast.BLangInvocation:
		method = n.Name.GetValue()
	case *ast.BLangRemoteMethodCallAction:
		method = n.Name.GetValue()
	case *ast.BLangClientResourceAccessAction:
		// Keep resource path segments exactly as written rather than treating them
		// as constructor-relative HTTP paths.
		text := p.located(id, call).Text
		receiverPos, callPos := receiver.GetPosition(), call.GetPosition()
		start := receiverPos.EndOffset() - callPos.StartOffset()
		if start >= 0 && start <= len(text) {
			method = strings.TrimSpace(text[start:])
		}
	}
	args := []LocatedModel{}
	for i, arg := range p.callArgs(call) {
		args = append(args, p.located(fmt.Sprintf("%s/argument/%d", id, i), arg))
	}
	return &ClientInvocationModel{Context: context, Method: method, Arguments: args}
}

// Evaluation preserves operator nesting. Composite source expressions retain
// their exact text while exposing only the nested evaluations needing a view.
func (p *resolvedProgram) evaluation(id string, expr ast.BLangActionOrExpression, calls []CallSiteModel) *EvaluationModel {
	if expr == nil {
		return nil
	}
	e := EvaluationModel{LocatedModel: p.located(id, expr), Kind: "source", Children: []EvaluationModel{}}
	add := func(child ast.BLangActionOrExpression) {
		if c := p.evaluation(fmt.Sprintf("%s/part/%d", id, len(e.Children)), child, calls); c != nil {
			e.Children = append(e.Children, *c)
		}
	}
	if call, ok := expr.(ast.Invocable); ok {
		for i := range calls {
			if calls[i].Source == e.Source {
				c := calls[i]
				e.Call = &c
				break
			}
		}
		if call.Receiver() != nil {
			add(call.Receiver())
		}
		for _, segment := range resourcePathExpressions(call) {
			add(segment)
		}
		for _, arg := range p.callArgs(call) {
			add(arg)
		}
		if e.Call != nil {
			e.Kind = "call"
		}
	} else {
		switch n := expr.(type) {
		case *ast.BLangCheckedExpr:
			e.Kind = "check"
			add(n.Expr)
		case *ast.BLangCheckPanickedExpr:
			e.Kind = "checkpanic"
			add(n.Expr)
		case *ast.BLangTrapExpr:
			e.Kind = "trap"
			add(n.Expr)
		case *ast.BLangGroupExpr:
			return p.evaluation(id, n.Expression, calls)
		case *ast.BLangTemplateExpr:
			if n.Kind == ast.TemplateExprKindString {
				e.Kind = "template"
				e.Strings = n.Strings
				for _, insertion := range n.Insertions {
					c := p.evaluation(fmt.Sprintf("%s/insertion/%d", id, len(e.Children)), insertion, calls)
					if c == nil {
						c = &EvaluationModel{LocatedModel: p.located(fmt.Sprintf("%s/insertion/%d", id, len(e.Children)), insertion), Kind: "source", Children: []EvaluationModel{}}
					}
					e.Children = append(e.Children, *c)
				}
			}
		case *ast.BLangBinaryExpr:
			if n.OpKind == model.OperatorKind_AND || n.OpKind == model.OperatorKind_OR {
				return nil
			}
			add(n.LhsExpr)
			add(n.RhsExpr)
		case *ast.BLangUnaryExpr:
			add(n.Expr)
		case *ast.BLangFieldBaseAccess:
			add(n.Expr)
		case *ast.BLangIndexBasedAccess:
			add(n.Expr)
			add(n.IndexExpr)
		case *ast.BLangNamedArgsExpression:
			add(n.Expr)
		case *ast.BLangListConstructorExpr:
			for _, x := range n.Exprs {
				add(x)
			}
		case *ast.BLangMappingConstructorExpr:
			for _, field := range n.Fields {
				if f, ok := field.(*ast.BLangMappingKeyValueField); ok {
					if f.Key != nil {
						add(f.Key.Expr)
					}
					add(f.ValueExpr)
				}
			}
		case *ast.BLangNewExpression:
			for _, x := range p.newArgs(n) {
				add(x)
			}
		case *ast.BLangTypeTestExpr:
			add(n.Expr)
		}
	}
	if (e.Kind == "check" || e.Kind == "checkpanic" || e.Kind == "trap") && len(e.Children) == 0 {
		var operand ast.BLangActionOrExpression
		switch n := expr.(type) {
		case *ast.BLangCheckedExpr:
			operand = n.Expr
		case *ast.BLangCheckPanickedExpr:
			operand = n.Expr
		case *ast.BLangTrapExpr:
			operand = n.Expr
		}
		e.Children = append(e.Children, EvaluationModel{LocatedModel: p.located(id+"/operand", operand), Kind: "source", Children: []EvaluationModel{}})
	}
	if e.Kind == "source" && len(e.Children) == 0 {
		return nil
	}
	// Ordinary function calls retain the existing renderer unless enclosed by a
	// newly modeled expression. This avoids changing their expansion behavior.
	return &e
}

func hasEvaluation(e *EvaluationModel) bool {
	if e == nil {
		return false
	}
	if e.Kind == "check" || e.Kind == "checkpanic" || e.Kind == "trap" || e.Kind == "template" || (e.Call != nil && e.Call.Client != nil) {
		return true
	}
	for i := range e.Children {
		if hasEvaluation(&e.Children[i]) {
			return true
		}
	}
	return false
}
func (p *resolvedProgram) renderedEvaluation(id string, expr ast.BLangActionOrExpression, calls []CallSiteModel) *EvaluationModel {
	e := p.evaluation(id, expr, calls)
	if !hasEvaluation(e) {
		return nil
	}
	return e
}

func (p *resolvedProgram) callArgs(call ast.Invocable) []ast.BLangExpression {
	if args, ok := p.sourceCallArgs[call]; ok {
		return args
	}
	return call.CallArgs()
}
func (p *resolvedProgram) newArgs(expr *ast.BLangNewExpression) []ast.BLangExpression {
	if args, ok := p.sourceNewArgs[expr]; ok {
		return args
	}
	return expr.ArgsExprs
}

func resourcePathExpressions(call ast.Invocable) []ast.BLangExpression {
	var exprs []ast.BLangExpression
	if resource, ok := call.(*ast.BLangClientResourceAccessAction); ok {
		for _, segment := range resource.Path {
			if segment.Expr != nil {
				exprs = append(exprs, segment.Expr)
			}
		}
	}
	return exprs
}

// An assignment may evaluate a computed target before evaluating its value.
// Retain those calls when the value switches to the structured renderer.
func (p *resolvedProgram) statementEvaluation(id string, statement ast.Node, lhs ast.BLangExpression, rhs ast.BLangActionOrExpression, calls []CallSiteModel) *EvaluationModel {
	value := p.evaluation(id+"/value", rhs, calls)
	target := p.evaluation(id+"/target", lhs, calls)
	if !hasEvaluation(value) && !hasEvaluation(target) {
		return nil
	}
	if target == nil {
		return value
	}
	children := []EvaluationModel{*target}
	if value != nil {
		children = append(children, *value)
	}
	return &EvaluationModel{LocatedModel: p.located(id+"/evaluation", statement), Kind: "source", Children: children}
}

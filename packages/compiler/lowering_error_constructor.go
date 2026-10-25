package compiler

import (
	"fmt"
	"strings"

	"github.com/ballerina-nutcracker/ballerina/ast"
)

// errorConstructorPresentation preserves argument source spelling, not inferred
// runtime values. Prefixes and indentation are part of sections too, so their
// concatenation is exactly the full selection/measurement label.
func (b *graphBuilder) errorConstructorPresentation(id string, expr *ast.BLangErrorConstructorExpr) (HIRPresentation, error) {
	sections, err := b.errorConstructorSections(id, expr, "")
	if err != nil {
		return HIRPresentation{}, err
	}
	var label strings.Builder
	for _, section := range sections {
		label.WriteString(string(section.Text))
	}
	p := plain(HIRNodeStyleErrorConstructor, label.String()).Value.(HIRPlainPresentation)
	p.Sections = sections
	return HIRPresentation{Value: p}, nil
}

func (b *graphBuilder) errorConstructorSections(id string, expr *ast.BLangErrorConstructorExpr, indent string) (HIRList[HIRLabelSection], error) {
	sections := HIRList[HIRLabelSection]{}
	text := func(sid string, e ast.BLangActionOrExpression) (string, error) {
		loc, err := b.source(sid, e)
		if err != nil {
			return "", err
		}
		return strings.ReplaceAll(loc.Text, "\n", "\n"+indent+"  "), nil
	}
	for i, arg := range expr.PositionalArgs {
		sid := fmt.Sprintf("%s/error-argument/%d", id, i)
		if i == 0 {
			value, err := text(sid, arg)
			if err != nil {
				return nil, err
			}
			sections = append(sections, HIRLabelSection{Kind: HIRLabelSectionKindErrorMessage, Text: HIRText(indent + "Error: " + value)})
			continue
		}
		cause := ast.BLangActionOrExpression(arg)
		for {
			group, ok := cause.(*ast.BLangGroupExpr)
			if !ok {
				break
			}
			cause = group.Expression
		}
		if nested, ok := cause.(*ast.BLangErrorConstructorExpr); ok {
			sections = append(sections, HIRLabelSection{Kind: HIRLabelSectionKindErrorCause, Text: HIRText("\n" + indent + "Cause:\n")})
			children, err := b.errorConstructorSections(sid, nested, indent+"  ")
			if err != nil {
				return nil, err
			}
			sections = append(sections, children...)
		} else {
			value, err := text(sid, arg)
			if err != nil {
				return nil, err
			}
			sections = append(sections, HIRLabelSection{Kind: HIRLabelSectionKindErrorCause, Text: HIRText("\n" + indent + "Cause: " + value)})
		}
	}
	for i := range expr.NamedArgs {
		arg := &expr.NamedArgs[i]
		value, err := text(fmt.Sprintf("%s/error-detail/%d", id, i), arg.Expr)
		if err != nil {
			return nil, err
		}
		prefix := "\n"
		if i == 0 {
			prefix += indent + "Details:\n"
		}
		sections = append(sections, HIRLabelSection{Kind: HIRLabelSectionKindErrorDetail, Text: HIRText(prefix + indent + "  " + arg.GetName().GetValue() + ": " + value)})
	}
	return sections, nil
}

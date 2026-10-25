import React, { useMemo } from 'react';
import type { FlowUI, Located, Id } from '@bal-bot/workspace';
import { buildDiagram, layoutDiagram, nodeHint, type ExpansionPath, type DiagramNode } from './flow';
import { FlowEntry } from './flow-entry';
import { FlowSvg, flowBounds, labelSize, wrapLabel, type FlowSvgData } from './flow-svg';
export interface FlowViewProps { readonly flow: FlowUI; readonly references: readonly Located[]; readonly expanded: ReadonlySet<ExpansionPath>; readonly onToggle: (path: ExpansionPath) => void; readonly onSelect: (node: Located) => void; readonly onOpenFunction: (id: Id) => void; }
export function FlowView({flow, references, expanded, onToggle, onSelect, onOpenFunction}: FlowViewProps): React.JSX.Element {
  const isReferenced = (node: Located) => references.some(reference => reference.id === node.id && reference.text === node.text && JSON.stringify(reference.source) === JSON.stringify(node.source));
  const state = flow.state, program = state.kind === 'ready' ? state.program : state.previous, ready = state.kind === 'ready';
  const selection = flow.selection;
  const entryFunction = program && selection.kind === 'function' ? program.functions[selection.functionId] : undefined;
  const layout = useMemo(() => program && selection.kind === 'function' ? layoutDiagram(buildDiagram(program, selection.functionId, expanded), labelSize) : undefined, [program, selection.kind, selection.kind === 'function' ? selection.functionId : selection.scopeId, expanded]);
  const nodes: DiagramNode[] = [];
  const collect = (items: readonly DiagramNode[]) => { for (const n of items) {nodes.push(n); collect(n.children);} }; if (layout) collect(layout.diagram.nodes);
  // Legacy hints are consumed only at this adapter boundary, never by shared SVG.
  const data: FlowSvgData | undefined = layout && {
    bounds: flowBounds(nodes.filter(n => !nodeHint(n)?.root).map(n => layout.boxes[n.id]), [...layout.routes]),
    nodes: nodes.filter(n => !nodeHint(n)?.root).map(n => {
      const hint = nodeHint(n);
      return {id: n.id, kind: n.kind, selection: n.selection, label: n.label, box: layout.boxes[n.id], height: Math.max(52, labelSize(n.label).height + 28), selected: isReferenced(n.selection), container: n.children.length > 0 && hint?.mode !== 'if', recursive: hint?.recursive, client: !!n.client,
        text: wrapLabel(n.label).join('\n'), sections: n.client ? n.label.split('\n').map((line, i) => ({className: i === 0 ? 'client-receiver' : i === 1 ? 'client-context' : 'client-method', text: wrapLabel(line).join('\n')})) : [],
        context: n.contextPath ? {path: n.contextPath, expanded: !!n.contextExpanded} : undefined,
        call: hint?.path ? {path: hint.path, expanded: expanded.has(hint.path), unavailable: hint.unavailable, title: hint.unavailable ?? 'Expand workspace function', ariaLabel: `${hint.recursive ? 'Recursive call' : expanded.has(hint.path) ? 'Collapse' : 'Expand'} ${n.label}`, glyph: hint.recursive ? '↻' : expanded.has(hint.path) ? '−' : '+'} : undefined, unavailable: hint?.unavailable};
    }),
    edges: layout.diagram.edges.map((edge, i) => ({kind: edge.kind, label: edge.label, route: layout.routes[i]})),
    iterations: layout.diagram.ports.filter(p => p.role === 'next-iteration').map(p => ({id: p.id, box: layout.boxes[p.nodeId]})),
  };
  return <div className="flow-view" data-analysis={state.kind}>
    {!ready && <div className="flow-notice" role="status">{state.kind === 'pending' ? 'Analyzing saved source…' : state.kind === 'failed' ? state.message : 'Fix the source errors to refresh this flow.'}{program && ' Displayed flow is stale. Source references are disabled.'}</div>}
    {(state.kind === 'invalid' || state.kind === 'ready') && state.diagnostics.length > 0 && <ul className="flow-diagnostics">{state.diagnostics.map((d,i) => <li key={i}>{d.file}{d.range ? `:${d.range.start.line}` : ''}: {d.message}</li>)}</ul>}
    {!program && state.kind !== 'pending' && <p className="flow-notice">No valid source analysis is available.</p>}
    {program && selection.kind === 'definitions' && (() => {
      const scope = program.scopes.find(s => s.id === selection.scopeId); if (scope?.kind !== 'service') return null;
      return <div className="definitions">{(['function','type','connector','configurable'] as const).map(kind => {
        const defs = scope.definitions.filter(d => d.kind === kind); if (!defs.length) return null;
        return <section key={kind}><h2>{({function:'Functions',type:'Types',connector:'Connectors',configurable:'Configurables'})[kind]}</h2>{defs.map(def => <div className="definition" key={def.id}><button disabled={!ready && def.kind !== 'function'} onClick={() => def.kind === 'function' ? onOpenFunction(def.functionId) : onSelect(def)}>{def.label}</button></div>)}</section>;
      })}</div>;
    })()}
    {layout && data && <div className="diagram-scroll">
      {entryFunction && program && <FlowEntry key={entryFunction.id} fn={entryFunction} program={program}/>}
      {data.nodes.length > 0 ? <FlowSvg data={data} ready={ready} onSelect={onSelect} onToggle={onToggle}/> : <p className="flow-empty">No statements in this function.</p>}</div>}
  </div>;
}

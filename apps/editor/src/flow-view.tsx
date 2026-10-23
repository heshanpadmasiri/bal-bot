import React, { useMemo } from 'react';
import type { FlowUI, Located, Id } from '@bal-bot/workspace';
import { buildDiagram, layoutDiagram, nodeHint, type ExpansionPath, type DiagramNode } from './flow';
import { FlowEntry } from './flow-entry';
export interface FlowViewProps { readonly flow: FlowUI; readonly references: readonly Located[]; readonly expanded: ReadonlySet<ExpansionPath>; readonly onToggle: (path: ExpansionPath) => void; readonly onSelect: (node: Located) => void; readonly onOpenFunction: (id: Id) => void; }
let canvas: HTMLCanvasElement | undefined;
function wrapLabel(label: string): string[] {
  canvas ??= document.createElement('canvas'); const ctx = canvas.getContext('2d')!; ctx.font = '13px monospace';
  const lines = label.split('\n').flatMap(line => {
    const result = ['']; for (const char of line) { if (ctx.measureText(result[result.length - 1] + char).width > 340) result.push(''); result[result.length - 1] += char; } return result;
  });
  return lines;
}
function labelSize(label: string): {width: number; height: number} {
  const lines = wrapLabel(label), ctx = canvas!.getContext('2d')!;
  return {width: Math.max(200, ...lines.map(l => ctx.measureText(l).width)), height: lines.length * 19};
}
export function FlowView({flow, references, expanded, onToggle, onSelect, onOpenFunction}: FlowViewProps): React.JSX.Element {
  const isReferenced = (node: Located) => references.some(reference => reference.id === node.id && reference.text === node.text && JSON.stringify(reference.source) === JSON.stringify(node.source));
  const state = flow.state, program = state.kind === 'ready' ? state.program : state.previous, ready = state.kind === 'ready';
  const selection = flow.selection;
  const entryFunction = program && selection.kind === 'function' ? program.functions[selection.functionId] : undefined;
  const layout = useMemo(() => program && selection.kind === 'function' ? layoutDiagram(buildDiagram(program, selection.functionId, expanded), labelSize) : undefined, [program, selection.kind, selection.kind === 'function' ? selection.functionId : selection.scopeId, expanded]);
  const nodes: DiagramNode[] = [];
  const collect = (items: readonly DiagramNode[]) => { for (const n of items) {nodes.push(n); collect(n.children);} }; if (layout) collect(layout.diagram.nodes);
  const bounds = layout && (() => {
    const boxes = nodes.filter(n => !nodeHint(n)?.root).map(n => layout.boxes[n.id]);
    const points = layout.routes.flat();
    const left = Math.min(...points.map(p => p.x), ...boxes.map(b => b.x), 0 === boxes.length ? 0 : Infinity);
    const right = Math.max(1, ...points.map(p => p.x), ...boxes.map(b => b.x + b.width));
    const top = Math.min(...points.map(p => p.y), ...boxes.map(b => b.y), 0 === boxes.length ? 0 : Infinity);
    const bottom = Math.max(1, ...points.map(p => p.y), ...boxes.map(b => b.y + b.height + 48));
    return {x: left - 32, y: top, width: right - left + 64, height: bottom - top + 16};
  })();
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
    {layout && bounds && <div className="diagram-scroll">
      {entryFunction && program && <FlowEntry key={entryFunction.id} fn={entryFunction} program={program}/>}
      {nodes.some(n => !nodeHint(n)?.root) ? <><div className="flow-entry-connector" aria-hidden="true"/><svg className="diagram" width={bounds.width} height={bounds.height} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{maxWidth: bounds.width}} role="group" aria-label="Source flow diagram">
      <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#7c8899" /></marker></defs>
      {nodes.filter(n => !nodeHint(n)?.root && n.children.length > 0 && nodeHint(n)?.mode !== 'if').map(n => { const b = layout.boxes[n.id]; return <rect key={n.id} className={`container ${n.kind}`} x={b.x} y={b.y} width={b.width} height={b.height} rx="12" />; })}
      {layout.routes.map((route,i) => <g key={i} data-edge-kind={layout.diagram.edges[i].kind}><polyline points={route.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#7c8899" strokeWidth="1.4" markerEnd="url(#flow-arrow)" />{['true','false'].includes(layout.diagram.edges[i].kind) && <text x={route[0].x + (layout.diagram.edges[i].kind === 'true' ? -10 : 10)} y={route[0].y - 8} textAnchor={layout.diagram.edges[i].kind === 'true' ? 'end' : 'start'} className="edge-label">{layout.diagram.edges[i].kind}</text>}</g>)}
      {layout.diagram.ports.filter(p => p.role === 'next-iteration').map(p => { const b = layout.boxes[p.nodeId]; return <g key={p.id} className="iteration-marker"><circle cx={b.x + b.width / 2 - 70} cy={b.y + b.height - 28} r="4" fill="#7c8899"/><text x={b.x + b.width / 2 - 60} y={b.y + b.height - 24} className="edge-label">next iteration</text></g>; })}
      {nodes.filter(n => !nodeHint(n)?.root).map(n => {
        const b = layout.boxes[n.id], hint = nodeHint(n), height = Math.max(52, labelSize(n.label).height + 28), selected = isReferenced(n.selection);
        return <g key={n.id} data-node-kind={n.kind} data-node-id={n.selection.id}>
          <rect x={b.x} y={b.y} width={b.width} height={height} className={`flow-node ${n.kind}${selected ? ' referenced' : ''}`} rx={n.kind === 'condition' ? 20 : 8}/>
          <foreignObject x={b.x+(b.width-Math.min(400,b.width))/2+10} y={b.y+8} width={Math.min(400,b.width)-20} height={height-12}><div className={`node-header${hint?.path ? ' has-disclosure' : ''}`}><button className="node-select" aria-pressed={selected} disabled={!ready} onClick={() => onSelect(n.selection)} aria-label={`Reference ${n.label}`}>{wrapLabel(n.label).join('\n')}</button></div></foreignObject>
          {hint?.path && <foreignObject className="node-disclosure-slot" x={b.x+8} y={b.y+8} width="30" height="30"><button className="node-disclosure" disabled={!!hint.unavailable} title={hint.unavailable ?? 'Expand workspace function'} aria-label={`${expanded.has(hint.path) ? 'Collapse' : 'Expand'} ${n.label}`} aria-expanded={expanded.has(hint.path)} onClick={() => onToggle(hint.path!)}>{expanded.has(hint.path) ? '−' : '+'}</button></foreignObject>}
          {hint?.unavailable && <foreignObject x={b.x} y={b.y+height+3} width={b.width} height="48"><div className="node-limitation">{hint.unavailable}</div></foreignObject>}
        </g>;
      })}
    </svg></> : <p className="flow-empty">No statements in this function.</p>}</div>}
  </div>;
}

import React from 'react';
import type { Id, Located, HIRVariableOccurrence } from '@bal-bot/workspace';
import { VariableText, type VariableHover } from './variable-text';

export interface FlowBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface FlowSvgNode {
  readonly id: Id; readonly kind: string; readonly selection: Located; readonly label: string; readonly box: FlowBox;
  readonly height: number; readonly selected: boolean; readonly container: boolean; readonly recursive?: boolean;
  readonly variables?: readonly HIRVariableOccurrence[];
  readonly client: boolean; readonly sections: readonly {readonly className: string; readonly text: string; readonly variables?: readonly HIRVariableOccurrence[]}[];
  readonly text: string; readonly context?: {readonly path: string; readonly expanded: boolean};
  readonly call?: {readonly path: string; readonly expanded: boolean; readonly unavailable?: string; readonly title: string; readonly ariaLabel: string; readonly glyph: string}; readonly unavailable?: string;
}
export interface FlowSvgData {
  readonly bounds: FlowBox;
  readonly nodes: readonly FlowSvgNode[];
  readonly edges: readonly {readonly kind: string; readonly label?: string; readonly route: readonly {readonly x: number; readonly y: number}[]}[];
  readonly iterations: readonly {readonly id: Id; readonly box: FlowBox}[];
}
let canvas: HTMLCanvasElement | undefined;
export function wrapLabel(label: string): string[] {
  canvas ??= document.createElement('canvas'); const ctx = canvas.getContext('2d')!; ctx.font = '13px monospace';
  const lines = label.split('\n').flatMap(line => {
    const result = ['']; for (const char of line) { if (ctx.measureText(result[result.length - 1] + char).width > 340) result.push(''); result[result.length - 1] += char; } return result;
  });
  return lines;
}
export function labelSize(label: string): {width: number; height: number} {
  const lines = wrapLabel(label), ctx = canvas!.getContext('2d')!;
  return {width: Math.max(200, ...lines.map(l => ctx.measureText(l).width)), height: lines.length * 19};
}
export function flowBounds(boxes: readonly FlowBox[], routes: FlowSvgData['edges'][number]['route'][]): FlowBox {
  const points = routes.flat();
  const left = Math.min(...points.map(p => p.x), ...boxes.map(b => b.x), 0 === boxes.length ? 0 : Infinity);
  const right = Math.max(1, ...points.map(p => p.x), ...boxes.map(b => b.x + b.width));
  const top = Math.min(...points.map(p => p.y), ...boxes.map(b => b.y), 0 === boxes.length ? 0 : Infinity);
  const bottom = Math.max(1, ...points.map(p => p.y), ...boxes.map(b => b.y + b.height + 48));
  return {x: left - 32, y: top, width: right - left + 64, height: bottom - top + 16};
}
/** Presentation only: adapters supply all labels, disclosure state and geometry. */
export function FlowSvg({data: {bounds, nodes, edges, iterations}, ready, onSelect, onToggle, activeVariable, onVariableHover}: VariableHover & {data: FlowSvgData; ready: boolean; onSelect: (node: Located) => void; onToggle: (path: string) => void}): React.JSX.Element {
  return <><div className="flow-entry-connector" aria-hidden="true"/><svg className="diagram" width={bounds.width} height={bounds.height} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{maxWidth: bounds.width}} role="group" aria-label="Source flow diagram">
      <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#7c8899" /></marker></defs>
      {nodes.filter(n => n.container).map(n => { const b = n.box; return <rect key={n.id} className={`container ${n.kind}`} x={b.x} y={b.y} width={b.width} height={b.height} rx="12" />; })}
      {edges.map((edge,i) => { const route = edge.route; return <g key={i} data-edge-kind={edge.kind}><polyline points={route.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#7c8899" strokeWidth="1.4" markerEnd="url(#flow-arrow)" />{(edge.label || ['true','false'].includes(edge.kind)) && <text x={route[0].x + (edge.kind === 'true' ? -10 : 10)} y={route[0].y - 8} textAnchor={edge.kind === 'true' ? 'end' : 'start'} className="edge-label">{edge.label ?? edge.kind}</text>}</g>; })}
      {iterations.map(p => { const b = p.box; return <g key={p.id} className="iteration-marker"><circle cx={b.x + b.width / 2 - 70} cy={b.y + b.height - 28} r="4" fill="#7c8899"/><text x={b.x + b.width / 2 - 60} y={b.y + b.height - 24} className="edge-label">next iteration</text></g>; })}
      {nodes.map(n => {
        const b = n.box, height = n.height, selected = n.selected;
        return <g key={n.id} data-node-kind={n.kind} data-node-id={n.selection.id} data-recursive={n.recursive || undefined}>
          <rect x={b.x} y={b.y} width={b.width} height={height} className={`flow-node ${n.kind}${selected ? ' referenced' : ''}${activeVariable && (n.client || n.kind === 'error-constructor' ? n.sections.some(s => s.variables?.some(v => v.variableId === activeVariable)) : n.variables?.some(v => v.variableId === activeVariable)) ? ' variable-related' : ''}${n.recursive ? ' recursive' : ''}`} rx={n.kind === 'condition' ? 20 : 8}/>
          <foreignObject x={b.x+(b.width-Math.min(400,b.width))/2+10} y={b.y+8} width={Math.min(400,b.width)-20} height={height-12}><div className={`node-header${n.client ? ' client-header' : n.kind === 'error-constructor' ? ' error-header' : ''}${n.call || n.context ? ' has-disclosure' : ''}`}><button className="node-select" aria-pressed={selected} disabled={!ready} onClick={() => onSelect(n.selection)} aria-label={`Reference ${n.label}`}>{n.client || n.kind === 'error-constructor' ? n.sections.map((section, i) => <span key={i} className={section.className}><VariableText text={section.text} variables={section.variables} activeVariable={activeVariable} onVariableHover={onVariableHover}/></span>) : <VariableText text={n.text} variables={n.variables} activeVariable={activeVariable} onVariableHover={onVariableHover}/>}</button></div></foreignObject>
          {n.context && <foreignObject x={b.x+b.width-38} y={b.y+8} width="30" height="30"><button className="node-disclosure" title="Show client initialization" aria-label={`${n.context.expanded ? 'Collapse' : 'Expand'} client initialization`} aria-expanded={n.context.expanded} onClick={() => onToggle(n.context!.path)}>{n.context.expanded ? '−' : '+'}</button></foreignObject>}
          {n.call && <foreignObject className="node-disclosure-slot" x={b.x+8} y={b.y+8} width="30" height="30"><button className="node-disclosure" disabled={!!n.call.unavailable} title={n.call.title} aria-label={n.call.ariaLabel} aria-expanded={!n.call.unavailable && n.call.expanded} onClick={() => onToggle(n.call!.path)}>{n.call.glyph}</button></foreignObject>}
          {n.unavailable && <foreignObject x={b.x} y={b.y+height+3} width={b.width} height="48"><div className="node-limitation">{n.unavailable}</div></foreignObject>}
        </g>;
      })}
    </svg></>;
}

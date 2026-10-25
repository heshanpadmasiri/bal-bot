// Test-only mount: bundled by the existing harness in development AND production.
import React, {useLayoutEffect, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FlowView, type FlowViewProps} from '../../src/flow-view';
import {FlowEntry} from '../../src/flow-entry';
import {hirFlow} from './hir-model-registry';

// Synthetic graph fixtures deliberately lack entry metadata. Omit only the entry
// component before React evaluates it; all SVG and graph HTML still come from
// the unmodified production FlowView (including its font measurement/layout).
function withoutEntry(value: React.ReactNode): React.ReactNode {
  return React.Children.map(value, child => {
    if (!React.isValidElement<{children?: React.ReactNode}>(child)) return child;
    if (child.type === FlowEntry) return null;
    return child.props.children === undefined ? child : React.cloneElement(child, {}, withoutEntry(child.props.children));
  });
}
function GraphOnly(props: FlowViewProps) { return withoutEntry(FlowView(props)); }

// Exact component identity for the pre-React commit observer; never infer
// selection or effective render state from labels, DOM, or workspace defaults.
(window as any).flowParityComponent = FlowView;
const renderInput = (props: FlowViewProps, graphOnly = false) => JSON.parse(JSON.stringify({
  flow: props.flow, references: props.references, expanded: [...props.expanded], graphOnly,
}));
let root: Root | undefined;
(window as any).mountRenderParity = (input: any) => {
  (window as any).editorRoot?.unmount();
  (window as any).editorRoot = undefined;
  const host = document.getElementById('editor-root')!;
  root?.unmount();
  root = createRoot(host);
  function Fixture() {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(input.expanded ?? []));
    const [references, setReferences] = useState<any[]>(input.references ?? []);
    const [selection, setSelection] = useState(input.selection);
    const state = hirFlow({state: input.state ?? {kind: 'ready', revision: 1, program: input.program, diagnostics: []}, selection}).flow.state;
    const props: FlowViewProps = {
      flow: {state, selection}, expanded, references,
      onToggle: path => setExpanded(old => {const next = new Set(old); if (next.has(path)) next.delete(path); else next.add(path); return next;}),
      onSelect: node => setReferences(old => old.some(item => item.id === node.id) ? old : [...old, node]),
      onOpenFunction: functionId => setSelection({kind: 'function', functionId}),
    };
    useLayoutEffect(() => {
      const value = renderInput(props, !!input.graphOnly);
      if ((window as any).flowParityRecord) (window as any).flowParityRecord(value);
      else (window as any).flowParityRenderInput = value;
    });
    return <div className={input.panelMode === 'expanded' ? 'flow-workspace inspection-expanded' : 'flow-workspace'} style={{width: input.width ?? '100%', height: input.height ?? '100%'}}><div className="inspection">{input.graphOnly ? <GraphOnly {...props}/> : <FlowView {...props}/>}</div></div>;
  }
  flushSync(() => root!.render(<Fixture/>));
};

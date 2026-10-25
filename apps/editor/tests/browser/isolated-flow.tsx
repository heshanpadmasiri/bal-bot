// Explicit captured HIR only: no Editor, compiler, workspace, or fixture registry.
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FlowView, type FlowViewProps} from '../../src/flow-view';
import {FlowEntry} from '../../src/flow-entry';
import '../../src/style.css';
// Frozen graph-only scenarios intentionally have no entry metadata.
function withoutEntry(value: React.ReactNode): React.ReactNode {
  return React.Children.map(value, child => {
    if (!React.isValidElement<{children?: React.ReactNode}>(child)) return child;
    if (child.type === FlowEntry) return null;
    return child.props.children === undefined ? child : React.cloneElement(child, {}, withoutEntry(child.props.children));
  });
}
function GraphOnly(props: FlowViewProps) { return withoutEntry(FlowView(props)); }
let root: Root | undefined;
(window as any).mountIsolatedFlow = (input: any) => {
  root?.unmount();
  root = createRoot(document.getElementById('editor-root')!);
  // Replay every committed prop transition, preserving SVG attribute ordering.
  for (const commit of input.commits ?? [input]) {
    const props: FlowViewProps = {...commit, expanded: new Set<string>(commit.expanded), onToggle() {}, onSelect() {}, onOpenFunction() {}};
    flushSync(() => root!.render(commit.graphOnly ? <GraphOnly {...props}/> : <FlowView {...props}/>));
  }
};
(window as any).isolatedFlowReady = true;

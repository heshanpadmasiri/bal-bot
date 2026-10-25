// Test-only mounts; all graph rendering is delegated to the actual HIR component.
import React, {useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HIRFlowView} from '../../src/hir-flow-view';
import {hirFlow} from './hir-model-registry';
(window as any).flowParityComponent = HIRFlowView;
let root: Root | undefined;
(window as any).mountRenderParity = (input: any) => {
  (window as any).editorRoot?.unmount();
  (window as any).editorRoot = undefined;
  root?.unmount();
  root = createRoot(document.getElementById('editor-root')!);
  const initial = hirFlow({state: input.state ?? {kind: 'ready', revision: 1, program: input.program, diagnostics: []}, selection: input.selection});
  // The shared observer predates graphOnly props. Keep explicit fixture metadata
  // in its capture without changing the frozen actions or observing the DOM.
  const record = (window as any).flowParityRecord;
  if (record) (window as any).flowParityRecord = (value: any) => record({...value, graphOnly: !!input.graphOnly});
  function Fixture() {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(input.expanded ?? []));
    const [references, setReferences] = useState<any[]>(input.references ?? []);
    const [selection, setSelection] = useState(input.selection);
    return <div className={input.panelMode === 'expanded' ? 'flow-workspace inspection-expanded' : 'flow-workspace'} style={{width: input.width ?? '100%', height: input.height ?? '100%'}}><div className="inspection"><HIRFlowView
      flow={{...initial.flow, selection}} expanded={expanded} references={references}
      onToggle={(path: string) => setExpanded(old => {const next = new Set(old); if (next.has(path)) next.delete(path); else next.add(path); return next;})}
      onSelect={(node: any) => setReferences(old => old.some(item => item.id === node.id) ? old : [...old, node])}
      onOpenFunction={(functionId: string) => setSelection({kind: 'function', functionId})}/></div></div>;
  }
  flushSync(() => root!.render(<Fixture/>));
};

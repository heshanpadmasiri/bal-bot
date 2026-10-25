// Isolated HIR page: no Editor, legacy model, workspace, compiler, or adapter.
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {HIRFlowView} from '../../src/hir-flow-view';
import '../../src/style.css';
let root: Root | undefined;
(window as any).mountIsolatedFlow = (input: any) => {
  root?.unmount();
  root = createRoot(document.getElementById('editor-root')!);
  for (const commit of input.commits ?? [input]) {
    const props = {...commit, expanded: new Set<string>(commit.expanded), onToggle() {}, onSelect() {}, onOpenFunction() {}};
    flushSync(() => root!.render(<HIRFlowView {...props}/>));
  }
};
(window as any).isolatedFlowReady = true;

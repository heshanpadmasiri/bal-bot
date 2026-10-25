// Explicit native-compiled HIR input; production component, no legacy adapter.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FlowView} from '../../apps/editor/src/flow-view';
import '../../apps/editor/src/style.css';
const result = await (await fetch('/post-baseline-analysis.json')).json();
if (result.kind !== 'valid') throw Error(JSON.stringify(result));
const entry = Object.entries(result.program.functions).find(([, graph]: any) => graph.entry.name === 'main');
if (!entry) throw Error('Missing main');
function Preview() {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  return <FlowView flow={{state:{kind:'ready', revision:1, program:result.program, diagnostics:result.diagnostics}, selection:{kind:'function',functionId:entry![0]}}} references={[]} expanded={expanded} onToggle={path=>setExpanded(current=>{const next=new Set(current);next.has(path)?next.delete(path):next.add(path);return next;})} onSelect={()=>{}} onOpenFunction={()=>{}}/>;
}
createRoot(document.getElementById('editor-root')!).render(<Preview/>);

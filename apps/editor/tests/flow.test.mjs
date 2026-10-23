import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDiagram,layoutDiagram,nodeHint} from '../src/flow.ts';
const located=(id,text=id)=>({id,text,source:{file:'main.bal',range:{start:{line:1,column:1},end:{line:1,column:text.length+1}}}});
const step=(id)=>({...located(id),kind:'simple',operation:'assign',presentation:'step',calls:[]});
const fn=(id,body)=>({...located(id),moduleId:'test',body});
const nodes=d=>{const all=[];const visit=items=>items.forEach(n=>{all.push(n);visit(n.children);});visit(d.nodes);return all;};
function structural(d){const ns=new Set(nodes(d).map(n=>n.id)),ps=new Set(d.ports.map(p=>p.id));assert.equal(ns.size,nodes(d).length);assert.equal(ps.size,d.ports.length);for(const p of d.ports)assert.ok(ns.has(p.nodeId));for(const e of d.edges){assert.ok(ps.has(e.fromPort));assert.ok(ps.has(e.toPort));}}
test('library calls render once as source steps and retain sequence connections',()=>{
 const print={...located('print','io:println("Hello, World!");'),kind:'simple',operation:'expression',presentation:'step',calls:[{...located('print/call','io:println("Hello, World!")'),target:{kind:'external',label:'println'},expansion:'unavailable',reason:'The target is outside the workspace.'}]};
 const diagram=buildDiagram({scopes:[],functions:{main:fn('main',[print,step('after')])}},'main',new Set());structural(diagram);
 const visible=nodes(diagram).filter(n=>!nodeHint(n)?.root);
 assert.deepEqual(visible.map(n=>n.label),[print.text,'after']);
 assert.equal(visible[0].selection,print);
 assert.equal(visible[0].children.length,0);
 assert.ok(diagram.edges.some(e=>e.fromPort==='main/print:normal-exit'&&e.toPort==='main/after:entry'));
});
test('abrupt exits, empty branches and unsupported regions have no invented continuation',()=>{
 const ret={...located('return'),kind:'return',calls:[]}, limited={...located('limited'),kind:'unsupported',reason:'unknown effect'};
 const branch={...located('if'),kind:'if',condition:{...located('condition'),calls:[]},thenBody:[ret],elseBody:[]};
 const p={scopes:[],functions:{main:fn('main',[branch,step('next'),limited,step('unreachable')])}};const d=buildDiagram(p,'main',new Set());structural(d);
 const ports=new Map(d.ports.map(p=>[p.id,p]));for(const e of d.edges){const from=ports.get(e.fromPort),to=ports.get(e.toPort);if(from.nodeId.includes('/return'))assert.notEqual(to.nodeId,'main/next');assert.ok(!from.nodeId.endsWith('/limited'));}
 assert.ok(d.edges.some(e=>e.kind==='false'));assert.ok(nodes(d).some(n=>n.selection.id==='unreachable'));
});
test('loops preserve nested break/continue ownership and foreach has no routine back edge',()=>{
 const inner={...located('foreach'),kind:'foreach',header:{...located('iteration'),calls:[]},body:[{...located('continue'),kind:'continue'},{...located('break'),kind:'break'}]};
 const outer={...located('while'),kind:'while',condition:{...located('condition'),calls:[]},body:[inner,step('increment')]};const d=buildDiagram({scopes:[],functions:{main:fn('main',[outer,step('after')])}},'main',new Set());structural(d);
 const ports=new Map(d.ports.map(p=>[p.id,p]));assert.ok(d.edges.some(e=>e.kind==='back'));const layout=layoutDiagram(d,()=>({width:300,height:20}));const next=d.edges.find(e=>e.kind==='continue'),exit=d.edges.find(e=>e.kind==='break');assert.equal(ports.get(next.toPort).role,'next-iteration');assert.equal(ports.get(exit.toPort).role,'normal-exit');assert.notDeepEqual(layout.routes[d.edges.indexOf(next)].at(-1),layout.routes[d.edges.indexOf(exit)].at(-1));for(const e of d.edges.filter(e=>['break','continue'].includes(e.kind))){const to=ports.get(e.toPort);assert.ok(to.nodeId.includes('/foreach'));assert.notEqual(e.kind,'back');}
});
test('call occurrences expand independently; callee returns stay inside their call and recursion stays finite',()=>{
 const call=(id,target)=>({...located(id),kind:'simple',operation:'declare',presentation:'step',calls:[{...located(id+'/call'),target:{kind:'workspace',functionId:target},expansion:'supported'}]});
 const p={scopes:[],functions:{main:fn('main',[call('first','helper'),call('second','helper'),step('after')]),helper:fn('helper',[call('recursive','helper'),{...located('ret'),kind:'return',calls:[]}])}};
 const collapsed=buildDiagram(p,'main',new Set());const paths=nodes(collapsed).filter(n=>nodeHint(n)?.path).map(n=>nodeHint(n).path);assert.equal(paths.length,2);
 const d=buildDiagram(p,'main',new Set(paths));structural(d);assert.equal(nodes(d).filter(n=>n.selection.id==='ret').length,2);assert.equal(nodes(d).filter(n=>nodeHint(n)?.unavailable==='Recursive calls remain collapsed.').length,2);
 for(const e of d.edges.filter(e=>e.kind==='return'&&e.fromPort.includes('/ret:'))){assert.equal(e.toPort,e.fromPort.slice(0,-'/ret:return'.length)+':normal-exit');}
 const layout=layoutDiagram(d,label=>({width:Math.min(340,label.length*8),height:20}));assert.equal(layout.routes.length,d.edges.length);for(const n of nodes(d)){const b=layout.boxes[n.id];assert.ok(b.width>=200&&b.height>=52);}
});
test('routing avoids unrelated source boxes through nested branch and loop lanes',()=>{
 const branch=(id,a,b)=>({...located(id),kind:'if',condition:{...located(id+'/condition'),calls:[]},thenBody:a,elseBody:b});
 const loop={...located('loop'),kind:'while',condition:{...located('loop/condition'),calls:[]},body:[branch('nested',[step('left')],[step('right')]),step('body-end')]};
 const diagram=buildDiagram({scopes:[],functions:{main:fn('main',[branch('outer',[loop],[step('other-lane')]),step('after')])}},'main',new Set());const layout=layoutDiagram(diagram,()=>({width:300,height:20})),all=nodes(diagram),parents=new Map();for(const node of all)for(const child of node.children)parents.set(child.id,node.id);
 const isAncestor=(id,child)=>{for(let p=parents.get(child);p;p=parents.get(p))if(id===p)return true;return false;};const ports=new Map(diagram.ports.map(p=>[p.id,p]));
 for(const [i,edge]of diagram.edges.entries()){
  const from=ports.get(edge.fromPort).nodeId,to=ports.get(edge.toPort).nodeId;
  for(const node of all){if(nodeHint(node)?.root||node.id===from||node.id===to||isAncestor(node.id,from)||isAncestor(node.id,to))continue;const b=layout.boxes[node.id],route=layout.routes[i];for(let j=1;j<route.length;j++){const a=route[j-1],c=route[j],intersects=a.x===c.x?a.x>b.x&&a.x<b.x+b.width&&Math.max(a.y,c.y)>b.y&&Math.min(a.y,c.y)<b.y+b.height:a.y>b.y&&a.y<b.y+b.height&&Math.max(a.x,c.x)>b.x&&Math.min(a.x,c.x)<b.x+b.width;assert.ok(!intersects,`edge ${edge.kind} crosses ${node.selection.id}`);}}
 }
});
test('branch arrows leave opposite sides with orthogonal routes and top-level returns terminate',()=>{
 const ret={...located('return','return total;'),kind:'return',calls:[]};
 const branch={...located('if'),kind:'if',condition:{...located('condition'),calls:[]},thenBody:[step('yes')],elseBody:[step('no')]};
 const diagram=buildDiagram({scopes:[],functions:{main:fn('main',[branch,ret])}},'main',new Set()),layout=layoutDiagram(diagram,()=>({width:300,height:20}));
 const condition=nodes(diagram).find(n=>n.kind==='condition'),box=layout.boxes[condition.id],ports=new Map(diagram.ports.map(p=>[p.id,p]));
 for(const [i,edge]of diagram.edges.entries()){
  const route=layout.routes[i];for(let j=1;j<route.length;j++)assert.ok(route[j].x===route[j-1].x||route[j].y===route[j-1].y,'every segment must be orthogonal');
  if(edge.kind==='true'||edge.kind==='false'){assert.equal(route[0].x,edge.kind==='true'?box.x:box.x+box.width);assert.equal(route[0].y,box.y+box.height/2);assert.equal(route.length,3,'an unobstructed branch needs only one bend');assert.equal(route[1].y,route[0].y);assert.ok(edge.kind==='true'?route[1].x<route[0].x:route[1].x>route[0].x);}
  assert.notEqual(ports.get(edge.fromPort).nodeId,'main/return');
 }
 assert.equal(nodes(diagram).find(n=>n.selection.id==='return').kind,'return');
});

test('direct and mutual recursion retain call sites and continuations even with stale expansion paths',()=>{
 const ret=(id,targets)=>({...located(id),kind:'return',calls:targets.map((target,i)=>({...located(`${id}/call/${i}`,`${target}(${i})`),target:{kind:'workspace',functionId:target},expansion:'supported'}))});
 const p={scopes:[],functions:{fib:fn('fib',[ret('sum',['fib','fib'])]),even:fn('even',[ret('even-return',['odd'])]),odd:fn('odd',[ret('odd-return',['even'])])}};
 for(const root of ['fib','even']){
  const expanded=new Set();
  let diagram;
  for(let i=0;i<4;i++){
   diagram=buildDiagram(p,root,expanded);structural(diagram);
   for(const n of nodes(diagram))if(nodeHint(n)?.path)expanded.add(nodeHint(n).path);
  }
  const recursive=nodes(diagram).filter(n=>nodeHint(n)?.recursive);
  assert.equal(recursive.length,root==='fib'?2:1);
  for(const node of recursive){
   assert.equal(node.children.length,0);
   assert.equal(nodeHint(node).unavailable,'Recursive calls remain collapsed.');
   assert.ok(diagram.edges.some(e=>e.toPort===`${node.id}:entry`),'recursive call has an incoming execution edge');
   assert.ok(diagram.edges.some(e=>e.fromPort===`${node.id}:normal-exit`),'recursive call continues after completion');
  }
  const layout=layoutDiagram(diagram,()=>({width:300,height:20}));
  assert.equal(layout.routes.length,diagram.edges.length);
  for(const route of layout.routes)for(const point of route)assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
  const returnNodes=nodes(diagram).filter(n=>n.kind==='return');
  for(const node of returnNodes){
   const calls=node.children;
   for(let i=1;i<calls.length;i++)assert.ok(diagram.edges.some(e=>e.fromPort===`${calls[i-1].id}:normal-exit`&&e.toPort===`${calls[i].id}:entry`));
   assert.ok(diagram.edges.some(e=>e.fromPort===`${calls.at(-1).id}:normal-exit`&&e.toPort===`${node.id}:return`));
  }
 }
});

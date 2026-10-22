import {test, expect} from '@playwright/test';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createModels} from '@earendil-works/pi-ai';
import {openaiProvider} from '@earendil-works/pi-ai/providers/openai';
const names = ['service-discovery','automation-flow','definitions-and-calls','control-flow','function-expansion','source-ranges','analysis-recovery','chat-references','panel-state','unsupported-constructs','design-critique'];
function fixture(name) {const root=join(process.cwd(),'examples',name), files={};const visit=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())visit(path);else if(/\.(bal|toml)$/.test(entry.name))files[relative(root,path)]=readFileSync(path,'utf8');}};visit(root);return files;}
const inputs=Object.fromEntries(names.map(n=>[n,fixture(n)]));
const native=spawnSync('go',['run','./tests/native'],{cwd:join(process.cwd(),'packages/compiler'),env:{...process.env,GOWORK:'off'},input:JSON.stringify(Object.values(inputs)),encoding:'utf8',maxBuffer:8*1024*1024});
if(native.status!==0)throw Error(native.stderr);
const nativeModels=JSON.parse(native.stdout);
const registry=createModels();registry.setProvider(openaiProvider());const model=registry.getModels('openai')[0];
async function open(page,name){
 await page.route('**/api/session',r=>r.fulfill({json:{token:'test'}}));
 await page.route('**/api/providers',r=>r.fulfill({json:[{id:'openai',connected:true,models:[model]}]}));
 await page.goto('/apps/editor/tests/browser/harness.html');await page.waitForFunction(()=>window.ready&&window.mountEditor);
 await page.evaluate(files=>window.mountEditor(files),inputs[name]);await page.waitForFunction(()=>window.workspace.analysisSnapshot().kind==='ready');
 await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','ready');
}
test('native and real browser WASM models match for all supported fixtures',async({page})=>{
 await page.goto('/apps/editor/tests/browser/harness.html');await page.waitForFunction(()=>window.ready);
 for(const [index,name]of names.entries()){
  const {result,ticks}=await page.evaluate(async files=>{let ticks=0;const timer=setInterval(()=>ticks++,0);try{return {result:await compiler.analyze(files),ticks};}finally{clearInterval(timer);}},inputs[name]);expect(result,name).toEqual(nativeModels[index]);expect(ticks,`${name} main-thread responsiveness`).toBeGreaterThan(0);
 }
});
test('discovery, definitions, endpoint source selection and explicit chips-only send',async({page})=>{
 await open(page,'definitions-and-calls');
 await expect(page.getByRole('heading',{name:'Functions',exact:true})).toBeVisible();
 await expect(page.locator('.definitions').getByRole('button',{name:'unusedHelper',exact:true})).toBeVisible();
 await expect(page.locator('.definitions').getByRole('button',{name:'UnusedRecord',exact:true})).toBeVisible();
 await expect(page.locator('.definitions').getByRole('button',{name:'upstreamClient',exact:true})).toBeVisible();
 await page.locator('.endpoint').click();
 const source=page.locator('.node-select').first();await source.click();await source.click();
 await expect(page.locator('.reference-chip')).toHaveCount(1);expect(await page.evaluate(()=>window.prompts.length)).toBe(0);
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.locator('.message.user')).toContainText('main.bal:');
 await expect.poll(()=>page.evaluate(()=>window.prompts.length)).toBe(1);
 const message=await page.evaluate(()=>window.prompts[0]);expect(JSON.stringify(message)).toContain('<source-references>');expect(JSON.stringify(message)).toContain('int local = calculate(minimumAmount);');
});
test('20/60/20, scope drafts, expansion and floating chat survive panel changes',async({page})=>{
 await page.setViewportSize({width:1500,height:950});await open(page,'panel-state');
 await page.locator('.endpoint').first().click();
 await page.getByRole('textbox',{name:'Message PI'}).fill('keep this draft');
 const normal=await page.evaluate(()=>[...document.querySelector('.flow-workspace').children].map(e=>e.getBoundingClientRect().width));
 expect(normal.map(n=>Math.round(n))).toEqual([300,900,300]);
 await page.getByRole('button',{name:/Expand buildReport/}).click();
 await expect(page.getByRole('button',{name:/Collapse buildReport/})).toBeVisible();
 await page.getByRole('button',{name:'Expand inspection',exact:true}).click();
 await expect(page.locator('.inspection')).toHaveCSS('width','1500px');
 const box=await page.locator('.floating-chat .main-bar').boundingBox();await page.mouse.move(box.x+180,box.y+18);await page.mouse.down();await page.mouse.move(850,450);await page.mouse.up();
 const moved=await page.locator('.floating-chat').boundingBox();expect(moved.x).toBeGreaterThan(24);
 await page.setViewportSize({width:900,height:650});await expect.poll(async()=>{const resized=await page.locator('.floating-chat').boundingBox();return resized.x+resized.width;}).toBeLessThanOrEqual(901);
 await page.getByRole('button',{name:'Collapse inspection',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('keep this draft');
 await page.locator('.endpoint').last().click();await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('');await page.locator('.endpoint').first().click();await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('keep this draft');await expect(page.getByRole('button',{name:/Collapse buildReport/})).toBeVisible();
});
test('invalid edits retain stale flow, disable references and repair',async({page})=>{
 await open(page,'analysis-recovery');await page.locator('.node-select').first().click();await page.getByRole('textbox',{name:'Message PI'}).fill('prose survives');
 await page.evaluate(()=>workspace.write('main.bal',workspace.read('main.bal').replace('int amount = 2;','int amount = true + 2;')));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='invalid');await expect(page.locator('.node-select').first()).toBeDisabled();await expect(page.locator('.reference-chip')).toContainText('stale');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await page.evaluate(files=>workspace.write('main.bal',files['main.bal']),inputs['analysis-recovery']);await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');await expect(page.locator('.node-select').first()).toBeEnabled();await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('prose survives');
});
test('Automation and limited regions show exact source without async dependency edges',async({page})=>{
 await open(page,'unsupported-constructs');await expect(page.locator('.service')).toContainText('Automation');await expect(page.locator('[data-node-kind="mapping"]')).toHaveCount(1);await expect(page.locator('[data-node-kind="unsupported"]')).toHaveCount(3);await expect(page.locator('.node-limitation').first()).toContainText('not modeled');
});

test('expanded call bodies reference definitions, call headers reference sites, and recursion stays finite',async({page})=>{
 await open(page,'function-expansion');await page.getByRole('textbox',{name:'Message PI'}).fill('keep prose');
 await page.getByRole('button',{name:'Expand shared(2)',exact:true}).click();await page.getByRole('button',{name:'Expand shared(3)',exact:true}).click();
 const bodies=page.getByRole('button',{name:'Reference return adjust(value);',exact:true});await expect(bodies).toHaveCount(2);await bodies.first().click();await bodies.last().click();await expect(page.locator('.reference-chip')).toHaveCount(1);await expect(page.locator('.reference-chip')).toContainText('helpers.bal:');
 await page.getByRole('button',{name:'Reference shared(2)',exact:true}).click();await expect(page.locator('.reference-chip')).toHaveCount(2);await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('keep prose');
 await page.getByRole('button',{name:'Expand countdown(first)',exact:true}).click();await expect(page.getByRole('button',{name:'Expand countdown(value - 1)',exact:true})).toBeDisabled();await expect(page.locator('.node-limitation').filter({hasText:'Recursive calls remain collapsed.'})).toHaveCount(1);
});
test('obsolete browser completions and infrastructure failures retain current flow',async({page})=>{
 await open(page,'analysis-recovery');
 await page.evaluate(()=>{window.baseProgram=workspace.analysisSnapshot().program;window.controlAnalysis=true;workspace.write('main.bal',workspace.read('main.bal')+'\n// A');workspace.write('main.bal',workspace.read('main.bal').replace('// A','// B'));window.latestRevision=workspace.analysisSnapshot().revision;window.analysisRequests[1].resolve({kind:'valid',program:window.baseProgram,diagnostics:[]});});
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');await page.evaluate(()=>window.analysisRequests[0].resolve({kind:'invalid',diagnostics:[{severity:'error',message:'obsolete'}]}));await expect.poll(()=>page.evaluate(()=>workspace.analysisSnapshot().revision)).toBe(await page.evaluate(()=>window.latestRevision));await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','ready');
 await page.evaluate(()=>{workspace.write('main.bal',workspace.read('main.bal')+'\n// failure');window.analysisRequests[2].reject(Error('controlled runtime failure'));});await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','failed');await expect(page.locator('.flow-notice')).toContainText('controlled runtime failure');await expect(page.locator('.node-select').first()).toBeDisabled();
 await page.getByRole('textbox',{name:'Message PI'}).fill('Repair the saved source');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.prompts.length)).toBe(1);
});
test('a saved source update immediately before prompting blocks stale references',async({page})=>{
 await open(page,'chat-references');await page.locator('.endpoint').first().click();await page.locator('.node-select').first().click();await page.getByRole('textbox',{name:'Message PI'}).fill('do not lose this');
 await page.evaluate(async()=>{const [service]=await workspace.getServices();const endpoint=service.getEndpoints()[0];const original=endpoint.getAgent.bind(endpoint);endpoint.getAgent=async()=>{const agent=await original();workspace.write('main.bal',workspace.read('main.bal')+'\n// racing disk update');return agent;};});
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Saved source changed');expect(await page.evaluate(()=>window.prompts.length)).toBe(0);await expect(page.getByRole('textbox',{name:'Message PI'})).toHaveValue('do not lose this');
});
test('unsaved editor text does not invalidate analysis; removing selected scopes falls back to Automation',async({page})=>{
 await open(page,'chat-references');await page.locator('.endpoint').first().click();const revision=await page.evaluate(()=>workspace.analysisSnapshot().revision);
 await page.getByRole('button',{name:'main.bal',exact:true}).click();await page.getByRole('button',{name:'Edit file',exact:true}).click();await page.getByRole('textbox',{name:'Edit main.bal',exact:true}).fill('not saved');expect(await page.evaluate(()=>workspace.analysisSnapshot().revision)).toBe(revision);await expect(page.locator('.node-select').first()).toBeEnabled();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.evaluate(()=>workspace.write('main.bal','public function main() {}'));await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');await expect(page.locator('.service')).toContainText('Automation');await expect(page.locator('.endpoint')).toHaveCount(0);await expect(page.locator('.service')).toHaveClass(/selected/);
});

test('measured source labels fit their headers after nested expansion',async({page})=>{
 await open(page,'design-critique');await page.locator('.endpoint').first().click();
 await expect(page.locator('.node-select').first()).toHaveCSS('text-align','center');
 expect((await page.locator('[data-edge-kind="true"] polyline').first().getAttribute('points')).trim().split(/\s+/)).toHaveLength(3);
 await expect(page.locator('.flow-node.return').last()).toHaveCSS('fill','rgb(228, 244, 233)');
 const viewport=await page.locator('.diagram-scroll').boundingBox();for(const name of ['Reference foreach int item in items','Reference item < minimum']){const header=await page.getByRole('button',{name,exact:true}).boundingBox();expect(header.x).toBeGreaterThanOrEqual(viewport.x);expect(header.x).toBeLessThan(viewport.x+viewport.width);}
 await page.getByRole('button',{name:'Expand calculate(item)',exact:true}).click();
 const overflowing=await page.locator('.node-select').evaluateAll(buttons=>buttons.filter(button=>{const header=button.closest('foreignObject').getBoundingClientRect(),box=button.getBoundingClientRect();return box.height>header.height+1||button.scrollWidth>button.clientWidth+1;}).map(b=>b.getAttribute('aria-label')));expect(overflowing).toEqual([]);
});

test('flow fits panel width with margins through resize, panel mode and call expansion',async({page})=>{
 await page.setViewportSize({width:1864,height:984});await open(page,'design-critique');await page.getByRole('button',{name:'calculate',exact:true}).click();
 const assertFits=async()=>{
  await expect.poll(()=>page.locator('.diagram-scroll').evaluate(panel=>panel.scrollWidth-panel.clientWidth)).toBeLessThanOrEqual(1);
  const viewport=await page.locator('.diagram-scroll').boundingBox(),svg=await page.locator('.diagram').boundingBox();expect(svg.x-viewport.x).toBeGreaterThanOrEqual(19);expect(viewport.x+viewport.width-svg.x-svg.width).toBeGreaterThanOrEqual(19);
  for(const box of await page.locator('.flow-node').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right};}))){expect(box.x).toBeGreaterThan(viewport.x+19);expect(box.right).toBeLessThan(viewport.x+viewport.width-19);}
 };
 await assertFits();const narrow=await page.locator('.diagram').boundingBox();await page.getByRole('button',{name:'Expand inspection',exact:true}).click();await assertFits();expect((await page.locator('.diagram').boundingBox()).width).toBeGreaterThan(narrow.width);
 await page.setViewportSize({width:900,height:700});await assertFits();await page.getByRole('button',{name:'Collapse inspection',exact:true}).click();await assertFits();
 await page.locator('.endpoint').first().click();await page.getByRole('button',{name:'Expand calculate(item)',exact:true}).click();await assertFits();await page.getByRole('button',{name:'Reference return total;',exact:true}).click();await expect(page.locator('.reference-chip')).toHaveCount(1);
});

test('prompt references highlight matching nodes and clear on removal, scope change and send',async({page})=>{
 await open(page,'chat-references');await page.locator('.endpoint').first().click();
 const node=page.locator('.node-select').first(),box=page.locator('.flow-node').first();
 await expect(node).toHaveAttribute('aria-pressed','false');await node.click();await expect(node).toHaveAttribute('aria-pressed','true');await expect(box).toHaveCSS('stroke','rgb(53, 120, 212)');await expect(page.locator('.flow-node.referenced')).toHaveCount(1);
 await node.click();await expect(page.locator('.reference-chip')).toHaveCount(1);
 await page.locator('.endpoint').last().click();await expect(page.locator('.flow-node.referenced')).toHaveCount(0);await page.locator('.endpoint').first().click();await expect(page.locator('.flow-node.referenced')).toHaveCount(1);
 await page.locator('.reference-chip button').click();await expect(node).toHaveAttribute('aria-pressed','false');await expect(page.locator('.flow-node.referenced')).toHaveCount(0);
 await node.click();await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.prompts.length)).toBe(1);await expect(page.locator('.flow-node.referenced')).toHaveCount(0);
});


test('foreach is explicit and call disclosure stays in its top-left corner',async({page})=>{
 await open(page,'design-critique');await page.locator('.endpoint').first().click();
 await expect(page.getByRole('button',{name:'Reference foreach int item in items',exact:true})).toHaveText('foreach int item in items');
 await page.getByRole('button',{name:'Expand inspection',exact:true}).click();
 for(const action of ['Expand','Collapse']){
  const disclosure=page.getByRole('button',{name:`${action} calculate(item)`,exact:true}),group=disclosure.locator('xpath=ancestor::*[local-name()="g"][1]');
  const box=await group.locator('.flow-node').boundingBox(),control=await disclosure.boundingBox();
  expect(control.x).toBeGreaterThan(box.x);expect(control.x-box.x).toBeLessThan(10);expect(control.y).toBeGreaterThan(box.y);expect(control.y-box.y).toBeLessThan(10);
  await disclosure.click();await expect(page.locator('.reference-chip')).toHaveCount(0);
 }
});

import {test, expect} from '@playwright/test';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
const names = ['service-discovery','automation-flow','definitions-and-calls','control-flow','function-expansion','source-ranges','analysis-recovery','chat-references','panel-state','unsupported-constructs','design-critique'];
function fixture(name) {const root=join(process.cwd(),'examples',name), files={};const visit=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())visit(path);else if(/\.(bal|toml)$/.test(entry.name))files[relative(root,path)]=readFileSync(path,'utf8');}};visit(root);return files;}
const inputs=Object.fromEntries(names.map(n=>[n,fixture(n)]));
const native=spawnSync('go',['run','./tests/native'],{cwd:join(process.cwd(),'packages/compiler'),env:{...process.env,GOWORK:'off'},input:JSON.stringify(Object.values(inputs)),encoding:'utf8',maxBuffer:8*1024*1024});
if(native.status!==0)throw Error(native.stderr);
const nativeModels=JSON.parse(native.stdout);
test('Hello World library call renders as one source step', async ({page}) => {
 await open(page,'automation-flow');
 await page.evaluate(() => workspace.write('main.bal','import ballerina/io;\n\npublic function main() {\n    io:println("Hello, World!");\n}'));
 await page.waitForFunction(() => workspace.analysisSnapshot().kind === 'ready');
 await expect(page.locator('.node-select')).toHaveCount(1);
 const print=page.getByRole('button',{name:'Reference io:println("Hello, World!");',exact:true});
 await expect(print).toHaveText('io:println("Hello, World!");');
 await expect(page.locator('.node-disclosure')).toHaveCount(0);
 await expect(page.locator('.node-limitation')).toHaveCount(0);
 await print.click();
 await expect(page.locator('.reference-chip')).toHaveCount(1);
 await expect(page.locator('.reference-chip')).toContainText('main.bal:4');
});
test('agent replies render Markdown while user text and unsafe markup stay inert', async ({page}) => {
 await open(page,'definitions-and-calls');
 await page.evaluate(async () => {
  const [scope] = await workspace.getScopes();
  const agent = await scope.getAgent();
  agent.state.messages = [
   {role:'user',content:'**Keep this literal**'},
   {role:'assistant',content:[{type:'text',text:'# Result\n\n**Done** with `value`.\n\n- First\n- Second\n\n```ballerina\nfunction main() {}\n```\n\n| Name | Status |\n| --- | --- |\n| build | passed |\n\n[Docs](https://example.com)\n\n<script>window.markdownExecuted = true</script>\n\n[Unsafe](javascript:alert(1))'}],stopReason:'stop'},
  ];
 });
 await page.locator('.endpoint').first().click();
 await page.locator('.service').first().click();
 const reply = page.locator('.message.assistant');
 await expect(reply.getByRole('heading',{name:'Result'})).toBeVisible();
 await expect(reply.locator('strong')).toHaveText('Done');
 await expect(reply.locator('li')).toHaveText(['First','Second']);
 await expect(reply.locator('pre code.language-ballerina')).toHaveText('function main() {}\n');
 await expect(reply.getByRole('cell',{name:'passed',exact:true})).toBeVisible();
 await expect(reply.getByRole('link',{name:'Docs'})).toHaveAttribute('href','https://example.com');
 await expect(reply.locator('script')).toHaveCount(0);
 expect(await page.evaluate(() => window.markdownExecuted)).toBeUndefined();
 await expect(reply.locator('a[href^="javascript:"]')).toHaveCount(0);
 await expect(page.locator('.message.user pre')).toHaveText('**Keep this literal**');
});
test('chat renders action-only tool summaries through streaming, outcomes and scope restoration', async ({page}) => {
 await open(page,'definitions-and-calls');
 await page.evaluate(async () => {
  const [scope] = await workspace.getScopes();
  const agent = await scope.getAgent();
  window.summaryAgent = agent;
  agent.state.messages = [{role:'assistant',content:[{type:'text',text:'Preparing the change.'},{type:'toolCall',id:'summary-edit',name:'edit_file',arguments:{path:'private.bal',oldText:'secret old source',newText:'secret new source'},partialJson:'secret partial JSON'}],stopReason:'pending'}];
  agent.state.isStreaming = true;
 });
 await page.locator('.endpoint').first().click();
 await page.locator('.service').first().click();
 await expect(page.locator('.tool-summary')).toHaveText('Editing file…');
 await expect(page.locator('.message.assistant')).toContainText('Preparing the change.');
 await expect(page.locator('.conversation')).not.toContainText(/private\.bal|secret|edit_file|oldText|partialJson/);
 await page.evaluate(() => {
  const agent = window.summaryAgent;
  agent.state.isStreaming = false;
  agent.state.messages = [
   {...agent.state.messages[0],stopReason:'toolUse'},
   {role:'toolResult',toolCallId:'summary-edit',toolName:'edit_file',isError:false,content:[{type:'text',text:'Edited private.bal: secret source'}]},
   {role:'assistant',content:[{type:'toolCall',id:'summary-read',name:'read_file',arguments:{path:'private.bal'}},{type:'toolCall',id:'summary-delete',name:'delete_file',arguments:{path:'private.bal'}}],stopReason:'toolUse'},
   {role:'toolResult',toolCallId:'summary-read',toolName:'read_file',isError:true,content:[{type:'text',text:'File not found: private.bal'}]},
   {role:'toolResult',toolCallId:'summary-delete',toolName:'delete_file',isError:true,content:[{type:'text',text:'Operation aborted'}]},
   {role:'assistant',content:[{type:'text',text:'Finished explaining the change.'}],stopReason:'stop'},
  ];
 });
 await page.locator('.endpoint').first().click();
 await expect(page.locator('.tool-summary')).toHaveCount(0);
 await page.locator('.service').first().click();
 await expect(page.locator('.tool-summary')).toHaveText(['Edited file','Could not read file. File not found.','Stopped: delete file']);
 await expect(page.locator('.conversation')).toContainText('Finished explaining the change.');
 await expect(page.locator('.conversation')).not.toContainText(/private\.bal|secret|edit_file|read_file|delete_file/);
 await expect(page.locator('.conversation details,.message.toolResult')).toHaveCount(0);
 await expect(page.locator('.tool-summary button')).toHaveCount(0);
});
async function open(page,name){
 await page.goto('/apps/editor/tests/browser/harness.html');await page.waitForFunction(()=>window.ready&&window.mountEditor);
 await page.evaluate(async files=>{
  await window.loginProvider('openai','sk-browser-test-key');
  window.mountEditor(files);
 },inputs[name]);await page.waitForFunction(()=>window.workspace.analysisSnapshot().kind==='ready');
 await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','ready');
}
test('compact entry follows resource, remote and method selection with source-backed signatures',async({page})=>{
 await open(page,'service-discovery');
 await page.evaluate(()=>workspace.write('orders.bal',`import ballerina/http;
service /orders on new http:Listener(8080) {
 resource function get [int id](boolean includeItems = false) returns string { _ = id; _ = includeItems; return "order"; }
 remote function refresh(string note = "") returns boolean { _ = note; return true; }
 function formatOrder() returns string { return "order"; }
}
function sharedLabel() returns string { return "order"; }`));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');
 await page.getByRole('button',{name:'resource get /orders/[int id]',exact:true}).click();
 const entry=page.locator('.flow-entry');
 await expect(entry.getByRole('heading')).toHaveText('get/orders/[int id]');
 await expect(page.locator('.flow-entry-owner')).toHaveText('Service /orders · ballerina/http:Listener');
 await expect(entry.locator('details')).not.toHaveAttribute('open');
 await entry.locator('summary').click();
 await expect(entry.locator('.flow-entry-signature')).toHaveText('resource function get [int id](boolean includeItems = false) returns string');
 await expect(entry.locator('dt')).toHaveText(['Path','Input','Returns']);
 await expect(entry.locator('dd')).toHaveText(['[int id]','boolean includeItems = false','string']);
 await page.getByRole('button',{name:'remote refresh',exact:true}).click();
 await expect(entry).toHaveAttribute('aria-label','remote entry');
 await expect(entry.locator('details')).not.toHaveAttribute('open');
 await expect(page.locator('.flow-entry-owner')).toContainText('Service /orders');
 await entry.locator('summary').click();
 await expect(entry.locator('dd')).toHaveText(['string note = ""','boolean']);
 await page.locator('.service').filter({hasText:'/orders'}).click();
 await expect(page.locator('.flow-entry')).toHaveCount(0);
 await page.getByRole('button',{name:'formatOrder',exact:true}).click();
 await expect(entry).toHaveAttribute('aria-label','method entry');
 await expect(page.locator('.flow-entry-owner')).toHaveCount(0);
 await entry.locator('summary').click();
 await expect(entry.locator('.flow-entry-signature')).toHaveText('function formatOrder() returns string');
 await expect(entry.locator('dd')).toHaveText(['None','string']);
});
test('ordinary function entry handles defaults and empty bodies without an invented execution step',async({page})=>{
 await open(page,'automation-flow');
 await page.evaluate(()=>workspace.write('main.bal','public function main(string greeting = "Hello") { _ = greeting; }'));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');
 const entry=page.locator('.flow-entry');
 await expect(entry).toHaveAttribute('aria-label','function entry');
 await expect(entry.getByRole('heading')).toHaveText('main');
 await expect(page.locator('.flow-entry-owner')).toHaveCount(0);
 await entry.locator('summary').click();
 await expect(entry.locator('dd')).toHaveText(['string greeting = "Hello"','()']);
 await page.evaluate(()=>workspace.write('main.bal','public function main() {}'));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');
 await expect(page.locator('.flow-empty')).toHaveText('No statements in this function.');
 await expect(page.getByRole('group',{name:'Source flow diagram'})).toHaveCount(0);
});
test('sidebar endpoint names, marker alignment and resource operations',async({page})=>{
 await open(page,'service-discovery');
 await expect(page.getByRole('button',{name:'remote onBytes',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'remote refresh',exact:true})).toBeVisible();
 const resource=page.getByRole('button',{name:'resource get /inventory/items',exact:true});
 await expect(resource.locator('.endpoint-operation')).toHaveText('get');
 await expect(resource.locator('.endpoint-operation')).toHaveCSS('text-transform','uppercase');
 const positions=await page.locator('.endpoint').evaluateAll(rows=>rows.map(row=>[row.querySelector('small').getBoundingClientRect().x,row.querySelector('.endpoint-label').getBoundingClientRect().x]));
 expect(new Set(positions.map(([x])=>x)).size).toBe(1);
 expect(new Set(positions.map(([,x])=>x)).size).toBe(1);
 await resource.click();
 await expect(resource).toHaveClass(/selected/);
 await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','ready');
});
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
 await page.getByRole('textbox',{name:'Message'}).fill('keep this draft');
 const normal=await page.evaluate(()=>[...document.querySelector('.flow-workspace').children].map(e=>e.getBoundingClientRect().width));
 expect(normal.map(n=>Math.round(n))).toEqual([300,900,300]);
 await page.getByRole('button',{name:/Expand buildReport/}).click();
 await expect(page.getByRole('button',{name:/Collapse buildReport/})).toBeVisible();
 await page.getByRole('button',{name:'Expand inspection',exact:true}).click();
 await expect(page.locator('.inspection')).toHaveCSS('width','1500px');
 const box=await page.locator('.floating-chat .main-bar').boundingBox();await page.mouse.move(box.x+180,box.y+18);await page.mouse.down();await page.mouse.move(850,450);await page.mouse.up();
 const moved=await page.locator('.floating-chat').boundingBox();expect(moved.x).toBeGreaterThan(24);
 await page.setViewportSize({width:900,height:650});await expect.poll(async()=>{const resized=await page.locator('.floating-chat').boundingBox();return resized.x+resized.width;}).toBeLessThanOrEqual(901);
 await page.getByRole('button',{name:'Collapse inspection',exact:true}).click();await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('keep this draft');
 await page.locator('.endpoint').last().click();await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('');await page.locator('.endpoint').first().click();await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('keep this draft');await expect(page.getByRole('button',{name:/Collapse buildReport/})).toBeVisible();
});
test('invalid edits retain stale flow, disable references and repair',async({page})=>{
 await open(page,'analysis-recovery');await page.locator('.node-select').first().click();await page.getByRole('textbox',{name:'Message'}).fill('prose survives');
 await page.evaluate(()=>workspace.write('main.bal',workspace.read('main.bal').replace('int amount = 2;','int amount = true + 2;')));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='invalid');await expect(page.locator('.node-select').first()).toBeDisabled();await expect(page.locator('.reference-chip')).toContainText('stale');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await page.evaluate(files=>workspace.write('main.bal',files['main.bal']),inputs['analysis-recovery']);await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');await expect(page.locator('.node-select').first()).toBeEnabled();await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('prose survives');
});
test('Automation and limited regions show exact source without async dependency edges',async({page})=>{
 await open(page,'unsupported-constructs');await expect(page.locator('.service')).toContainText('Automation');await expect(page.locator('[data-node-kind="mapping"]')).toHaveCount(1);await expect(page.locator('[data-node-kind="unsupported"]')).toHaveCount(3);await expect(page.locator('.node-limitation').first()).toContainText('not modeled');
});

test('expanded call bodies reference definitions, call headers reference sites, and recursion stays finite',async({page})=>{
 await open(page,'function-expansion');await page.getByRole('textbox',{name:'Message'}).fill('keep prose');
 await page.getByRole('button',{name:'Expand shared(2)',exact:true}).click();await page.getByRole('button',{name:'Expand shared(3)',exact:true}).click();
 const bodies=page.getByRole('button',{name:'Reference return adjust(value);',exact:true});await expect(bodies).toHaveCount(2);await bodies.first().click();await bodies.last().click();await expect(page.locator('.reference-chip')).toHaveCount(1);await expect(page.locator('.reference-chip')).toContainText('helpers.bal:');
 await page.getByRole('button',{name:'Reference shared(2)',exact:true}).click();await expect(page.locator('.reference-chip')).toHaveCount(2);await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('keep prose');
 await page.getByRole('button',{name:'Expand countdown(first)',exact:true}).click();await expect(page.getByRole('button',{name:'Recursive call countdown(value - 1)',exact:true})).toBeDisabled();await expect(page.locator('.node-limitation').filter({hasText:'Recursive calls remain collapsed.'})).toHaveCount(1);
 await page.getByRole('button',{name:'Expand evenStep(second)',exact:true}).click();
 await page.getByRole('button',{name:'Expand oddStep(value - 1)',exact:true}).click();
 const mutual=page.getByRole('button',{name:'Recursive call evenStep(value - 1)',exact:true});
 await expect(mutual).toBeDisabled();await expect(mutual).toHaveText('↻');
 await expect(mutual).toHaveAttribute('aria-expanded','false');
 await expect(page.locator('[data-recursive="true"]')).toHaveCount(2);
});
test('obsolete browser completions and infrastructure failures retain current flow',async({page})=>{
 await open(page,'analysis-recovery');
 await page.evaluate(()=>{window.baseProgram=workspace.analysisSnapshot().program;window.controlAnalysis=true;workspace.write('main.bal',workspace.read('main.bal')+'\n// A');workspace.write('main.bal',workspace.read('main.bal').replace('// A','// B'));window.latestRevision=workspace.analysisSnapshot().revision;window.analysisRequests[1].resolve({kind:'valid',program:window.baseProgram,diagnostics:[]});});
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');await page.evaluate(()=>window.analysisRequests[0].resolve({kind:'invalid',diagnostics:[{severity:'error',message:'obsolete'}]}));await expect.poll(()=>page.evaluate(()=>workspace.analysisSnapshot().revision)).toBe(await page.evaluate(()=>window.latestRevision));await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','ready');
 await page.evaluate(()=>{workspace.write('main.bal',workspace.read('main.bal')+'\n// failure');window.analysisRequests[2].reject(Error('controlled runtime failure'));});await expect(page.locator('.flow-view')).toHaveAttribute('data-analysis','failed');await expect(page.locator('.flow-notice')).toContainText('controlled runtime failure');await expect(page.locator('.node-select').first()).toBeDisabled();
 await page.getByRole('textbox',{name:'Message'}).fill('Repair the saved source');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.prompts.length)).toBe(1);
});
test('a saved source update immediately before prompting blocks stale references',async({page})=>{
 await open(page,'chat-references');await page.locator('.endpoint').first().click();await page.locator('.node-select').first().click();await page.getByRole('textbox',{name:'Message'}).fill('do not lose this');
 await page.evaluate(async()=>{const [service]=await workspace.getServices();const endpoint=service.getEndpoints()[0];const original=endpoint.getAgent.bind(endpoint);endpoint.getAgent=async()=>{const agent=await original();workspace.write('main.bal',workspace.read('main.bal')+'\n// racing disk update');return agent;};});
 await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Saved source changed');expect(await page.evaluate(()=>window.prompts.length)).toBe(0);await expect(page.getByRole('textbox',{name:'Message'})).toHaveValue('do not lose this');
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

test('provider controls forget only the chosen API key',async({page})=>{
 await open(page,'design-critique');
 const backendRequests=[];
 page.on('request',request=>{if(/\/api\/(providers|login|logout|stream)/.test(request.url()))backendRequests.push(request.url());});
 await page.evaluate(async files=>{
  await window.loginProvider('anthropic','sk-ant-browser-test-key');
  window.mountEditor(files);
 },inputs['design-critique']);
 const picker=page.getByRole('button',{name:'Provider: OpenAI',exact:true});
 await expect(page.locator('header').getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);
 await expect(page.locator('.inspection').getByRole('button',{name:'Expand inspection',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Reference service definition|Reference calculate/})).toHaveCount(0);
 await picker.click();await page.getByRole('button',{name:/Anthropic Anthropic API key/}).click();
 await expect(page.getByRole('button',{name:'Forget API key',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Forget API key',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>{
  return (await window.getAccounts()).filter(account=>account.connected).map(account=>account.id);
 })).toEqual(['openai']);
 expect(backendRequests).toEqual([]);
 const selectedPicker=page.getByRole('button',{name:'Provider: Anthropic',exact:true});
 await selectedPicker.click();
 await page.getByRole('button',{name:/Anthropic Anthropic API key/}).click();
 await expect(page.getByRole('button',{name:'Forget API key',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await selectedPicker.click();await page.getByRole('button',{name:/OpenAI OpenAI API key/}).click();
 await expect(page.getByRole('button',{name:'Forget API key',exact:true})).toBeVisible();
});

test('inspection expansion is available only for flow diagrams',async({page})=>{
 await open(page,'design-critique');
 const expand=page.getByRole('button',{name:'Expand inspection',exact:true});
 await expect(expand).toHaveCount(0);
 await page.getByRole('button',{name:'calculate',exact:true}).click();
 await expect(page.getByRole('group',{name:'Source flow diagram'})).toBeVisible();
 await expand.click();
 await expect(page.getByRole('button',{name:'Collapse inspection',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'← Definitions',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Functions',exact:true})).toBeVisible();
 await expect(page.locator('.inspection-toggle')).toHaveCount(0);
 await expect(page.locator('.flow-workspace')).not.toHaveClass(/inspection-expanded/);
 await page.locator('.endpoint').first().click();
 await expect(expand).toBeVisible();
});


test('anchor activity follows concurrent chats and completion clears only on click', async ({page}) => {
 await open(page, 'definitions-and-calls');
 await page.evaluate(() => {window.holdResponses = true;});
 const service = page.locator('.service').first(), endpoint = page.locator('.endpoint').first();
 const running = row => row.getByRole('status', {name:'Chat running'});
 const completed = row => row.getByRole('status', {name:'Chat completed'});
 await page.getByRole('textbox', {name:'Message'}).fill('Update the service');
 await page.getByRole('button', {name:'Send message', exact:true}).click();
 await expect(running(service)).toBeVisible();
 await service.click();
 await expect(running(service)).toBeVisible();
 await endpoint.click();
 await page.getByRole('textbox', {name:'Message'}).fill('Update the endpoint');
 await page.getByRole('button', {name:'Send message', exact:true}).click();
 await expect(running(endpoint)).toBeVisible();
 await expect(running(service)).toBeVisible();
 await page.evaluate(() => window.pendingResponses[0]());
 await expect(completed(service)).toBeVisible();
 await expect(running(service)).toHaveCount(0);
 await expect(running(endpoint)).toBeVisible();
 await endpoint.click();
 await expect(completed(service)).toBeVisible();
 await service.click();
 await expect(completed(service)).toHaveCount(0);
 await page.evaluate(() => window.pendingResponses[1]());
 await expect(completed(endpoint)).toBeVisible();
 await endpoint.click();
 await expect(completed(endpoint)).toHaveCount(0);
 await page.getByRole('textbox', {name:'Message'}).fill('Run again');
 await page.getByRole('button', {name:'Send message', exact:true}).click();
 await expect(running(endpoint)).toBeVisible();
 await page.evaluate(() => window.pendingResponses[2]());
 await expect(completed(endpoint)).toBeVisible();
 await endpoint.click();
 await expect(completed(endpoint)).toHaveCount(0);
});

test('automation anchor shows running and completed activity', async ({page}) => {
 await open(page, 'automation-flow');
 await page.evaluate(() => {window.holdResponses = true;});
 const automation = page.locator('.service').first();
 await page.getByRole('textbox', {name:'Message'}).fill('Update the automation');
 await page.getByRole('button', {name:'Send message', exact:true}).click();
 await expect(automation.getByRole('status', {name:'Chat running'})).toBeVisible();
 await page.evaluate(() => window.pendingResponses[0]());
 await expect(automation.getByRole('status', {name:'Chat completed'})).toBeVisible();
 await automation.click();
 await expect(automation.getByRole('status')).toHaveCount(0);
});

test('Fibonacci arithmetic calls expand independently and recursive calls stay collapsed',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await open(page,'automation-flow');
 await page.evaluate(()=>workspace.write('main.bal',`import ballerina/http;
import ballerina/io;
service / on new http:Listener(8080) {
 resource function get hello() returns string { return "Hello, World!"; }
 resource function get [int x]/[int y]/sum() returns int {
  io:println("x: ", x, ", y: ", y);
  return fib(x) + fib(y);
 }
}
function fib(int n) returns int {
 if n <= 1 { return n; }
 return fib(n - 1) + fib(n - 2);
}`));
 await page.waitForFunction(()=>workspace.analysisSnapshot().kind==='ready');
 await page.locator('.endpoint').filter({hasText:'sum'}).click();
 await expect(page.getByRole('button',{name:'Expand fib(x)',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Expand fib(y)',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Expand fib(x)',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reference return fib(n - 1) + fib(n - 2);',exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'Expand fib(y)',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reference return fib(n - 1) + fib(n - 2);',exact:true})).toHaveCount(2);
 for(const arg of ['n - 1','n - 2']){
  const recursive=page.getByRole('button',{name:`Recursive call fib(${arg})`,exact:true});
  await expect(recursive).toHaveCount(2);
  for(const button of await recursive.all()){
   await expect(button).toBeDisabled();await expect(button).toHaveText('↻');
   await expect(button).toHaveAttribute('aria-expanded','false');
  }
 }
 await expect(page.locator('.node-limitation')).toHaveText(Array(4).fill('Recursive calls remain collapsed.'));
 await page.getByRole('button',{name:'Collapse fib(x)',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reference return fib(n - 1) + fib(n - 2);',exact:true})).toHaveCount(1);
 await page.locator('.service').click();
 await page.getByRole('button',{name:'fib',exact:true}).click();
 await expect(page.locator('[data-recursive="true"]')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Recursive call fib(n - 1)',exact:true})).toBeDisabled();
 const reference=page.getByRole('button',{name:'Reference fib(n - 1)',exact:true});
 await reference.click();
 await expect(page.locator('.reference-chip')).toHaveCount(1);
 expect(errors).toEqual([]);
});

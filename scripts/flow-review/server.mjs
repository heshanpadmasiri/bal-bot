#!/usr/bin/env node
// Exploratory human review only. Never writes baseline fixtures or accepts the gate.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, readdir, access, rename, mkdtemp, rm} from 'node:fs/promises';
import {spawn, fork} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {loadRenderCases} from '../../apps/editor/tests/render-cases.mjs';
import {captureFlow, renderStateSnapshot} from '../../packages/compiler/tests/browser/render-parity.spec.mjs';
import {loadFonts, fontDirectory, browserLaunchOptions} from '../flow-parity/environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = Number(portAt < 0 ? 4318 : args[portAt + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const storage = resolve('.bal-bot/flow-review');
await mkdir(storage, {recursive:true});
const scratch = await mkdtemp(join(tmpdir(), 'flow-review-'));
const cases = await loadRenderCases();
const byId = new Map(cases.map(item => [item.id,item]));
const hash = value => createHash('sha256').update(value).digest('hex');
const pipeline = 'isolated-svg+editor-integration';
const knownFailures = new Map([
 ['example-design-critique-fn-4353aabe1e-signature','Historical fresh-context PNG mismatch: calculate signature (first full recording). SVG, HTML, wrapper and styles matched.'],
 ['example-chat-references-fn-21e4194761-signature','Historical intermittent fresh-context PNG mismatch: shared signature (second full recording). SVG, HTML, wrapper and styles matched.'],
 ['project-eec8f54e8c8c-fn-ab75c87a86-reference','Historical fresh-context PNG mismatch: resource get second with reference highlight (serial software-rendered recording). SVG, HTML, wrapper and styles matched.'],
]);
const humanIds = new Map(cases.map(item => [item.id,`FR-${hash(item.id).slice(0,10).toUpperCase()}`]));
if (new Set(humanIds.values()).size !== cases.length) throw Error('Human review ID collision');
const readJSON = async file => JSON.parse(await readFile(file,'utf8'));
const exists = async path => {try {await access(path);return true;} catch(error){if(error.code==='ENOENT')return false;throw error;}};
const saveJSON = async (path,value) => {await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,path);};
let reviews = await exists(join(storage,'reviews.json')) ? await readJSON(join(storage,'reviews.json')) : {};
const captures = new Map();
const key = (id,mode) => `${id}/${mode}`;
const directory = (id,mode) => join(storage,'captures',humanIds.get(id),mode);
for(const item of cases) for(const mode of ['development','production']) {
 const path = join(directory(item.id,mode),'capture.json');
 if(await exists(path)) {const meta=await readJSON(path);if(meta.caseHash===hash(JSON.stringify(item))) captures.set(key(item.id,mode),meta);}
}
const children = new Set();
const run = (command,params,input) => new Promise((accept,reject)=>{
 const child=spawn(command,params,{cwd:root,env:{...process.env,GOWORK:'off'},stdio:input===undefined?'inherit':['pipe','pipe','pipe']}); children.add(child);
 let output='',error=''; if(input!==undefined){child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);child.stdin.end(input);}
 child.once('error',reject);child.once('exit',code=>{children.delete(child);code===0?accept(output):reject(Error(`${command} exited ${code}: ${error}`));});
});
let native;
let feedbackWrites = Promise.resolve();
const programs = new Map();
const sourceAssociationVersion = 2;
async function sourceProgram(item) {
 const files = {...item.input.files};
 const snapshots = [{...files}];
 for(const action of item.actions??[])if(action.type==='write'){files[action.file]=action.text;snapshots.push({...files});}
 const cacheKey=hash(JSON.stringify(snapshots));
 if(!programs.has(cacheKey)) programs.set(cacheKey,(async()=>{
  await native;
  const results=JSON.parse(await run(join(scratch,'native'),[],JSON.stringify(snapshots)));
  // Invalid/failed views retain the most recent valid program, not a partial one.
  return results.reduce((previous,result)=>result.kind==='valid'?result.program:previous,null);
 })());
 return programs.get(cacheKey);
}
function associateSource(html,program) {
 const signatures=[...html.matchAll(/<code\b[^>]*class="flow-entry-signature"[^>]*>([\s\S]*?)<\/code>/g)];
 if(signatures.length!==1)return {fn:null,sourceError:'No unique rendered function entry; showing project source instead.'};
 const decode=text=>text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(entity,value)=>{
  if(value[0]==='#')return String.fromCodePoint(value[1].toLowerCase()==='x'?parseInt(value.slice(2),16):Number(value.slice(1)));
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[value]??entity;
 });
 const signature=decode(signatures[0][1]);
 const candidates=Object.values(program?.functions??{}).filter(fn=>fn.entry?.signature===signature);
 // Never use the initial selection: replay can open another endpoint/definition.
 // Duplicate signatures are deliberately ambiguous rather than guessed from order.
 if(candidates.length!==1)return {fn:null,sourceError:'Rendered function cannot be uniquely associated with source; showing project source instead.'};
 const fn=candidates[0];
 if(!fn.text||!fn.source?.file)return {fn:null,sourceError:'Rendered function has no source metadata; showing project source instead.'};
 return {fn,sourceError:null};
}
async function captureSource(item,mode,meta) {
 if(!meta)return {fn:null,sourceError:'Capture an image before associating function source.'};
 const html=await readFile(join(directory(item.id,mode),'flow.html'),'utf8');
 const sourceHTMLHash=hash(html);
 if(meta.sourceAssociationVersion===sourceAssociationVersion&&meta.sourceHTMLHash===sourceHTMLHash)return meta;
 let association;
 try {
  association=item.input.kind==='synthetic'
   ? {fn:null,sourceError:'Synthetic graph-only capture has no project source association.'}
   : associateSource(html,await sourceProgram(item));
 }catch(error){association={fn:null,sourceError:`Source association failed: ${error.message}`};}
 const repaired={...meta,...association,sourceAssociationVersion,sourceHTMLHash};
 await saveJSON(join(directory(item.id,mode),'capture.json'),repaired);
 captures.set(key(item.id,mode),repaired);
 return repaired;
}
// Source analysis uses the nested Go module's working directory.
native = new Promise((accept,reject)=>{
 const child=spawn('go',['build','-o',join(scratch,'native'),'./tests/native'],{cwd:join(root,'packages/compiler'),env:{...process.env,GOWORK:'off'},stdio:'inherit'});children.add(child);
 child.once('error',reject);child.once('exit',code=>{children.delete(child);code===0?accept():reject(Error(`Native source lookup build exited ${code}`));});
});
native.catch(error=>console.error(error.message));
const queue=[];const queued=new Set();const errors={};let active=null;let working=false;let closing=false;
let browser,fonts,prepared,fontPromise;
const reviewFonts = () => fontPromise ??= loadFonts();
const servers=new Map();
async function origin(mode) {
 if(!servers.has(mode))servers.set(mode,new Promise((accept,reject)=>{
  const child=fork(join(root,'scripts/flow-parity/server.mjs'),[mode,join(scratch,mode)],{cwd:root,stdio:['ignore','inherit','inherit','ipc']});children.add(child);
  const timer=setTimeout(()=>reject(Error('Harness startup timed out')),180000);
  child.once('message',message=>{clearTimeout(timer);accept(`http://127.0.0.1:${message.port}`);});
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);children.delete(child);reject(Error(`Harness exited ${code}`));});
 }));
 return servers.get(mode);
}
async function prepare() {
 prepared ??= (async()=>{await run('python3',['scripts/build_compiler.py']);fonts=await reviewFonts();browser=await chromium.launch({...browserLaunchOptions,executablePath:chromium.executablePath()});})();
 return prepared;
}
function comparison(first,second) {
 return {
  ...Object.fromEntries(['svg','integrationSVG','isolatedSVG','flowHTML','wrapper','styles'].map(field=>[field,JSON.stringify(first[field])===JSON.stringify(second[field])])),
  renderState: JSON.stringify(renderStateSnapshot(first.renderInput))===JSON.stringify(renderStateSnapshot(second.renderInput)),
 };
}
async function render(item,mode,repeat) {
 await prepare();const baseURL=await origin(mode);
 async function createPinnedPage(){
  const context=await browser.newContext({baseURL,viewport:item.viewport,locale:'en-US',timezoneId:'UTC',deviceScaleFactor:1,colorScheme:'light',reducedMotion:'no-preference',serviceWorkers:'block'});
  try {await fonts.install(context,baseURL);const page=await context.newPage();page.setDefaultTimeout(90000);return page;}
  catch(error){await context.close();throw error;}
 }
 async function once(){
  const page=await createPinnedPage();const context=page.context();
  try {
   const capture=await captureFlow(page,item,{createIsolatedPage:createPinnedPage});
   const program=await page.evaluate(()=>{const state=window.workspace?.analysisSnapshot();return state?.kind==='ready'?state.program:state?.previous;});
   const source=item.input.kind==='synthetic'
    ? {fn:null,sourceError:'Synthetic graph-only capture has no project source association.'}
    : associateSource(capture.flowHTML,program);
   return {capture,...source};
  }finally{await context.close();}
 }
 const first=await once();const second=repeat?await once():null;
 const output=directory(item.id,mode);await mkdir(output,{recursive:true});
 await writeFile(join(output,'flow.html'),first.capture.flowHTML);
 if(first.capture.svg!==null)await writeFile(join(output,'diagram.svg'),first.capture.svg);
 else await rm(join(output,'diagram.svg'),{force:true});
 if(second?.capture.svg!=null)await writeFile(join(output,'repeat.svg'),second.capture.svg);
 else await rm(join(output,'repeat.svg'),{force:true});
 await saveJSON(join(output,'integration.json'),{integrationSVG:first.capture.integrationSVG,wrapper:first.capture.wrapper,styles:first.capture.styles,renderInput:first.capture.renderInput});
 const meta={pipeline,format:'svg',caseHash:hash(JSON.stringify(item)),origin:'Fresh exploratory capture — not a baseline',createdAt:new Date().toISOString(),repeat:!!second,svg:first.capture.svg!==null,repeatSVGPresence:second?.capture.svg!=null,fn:first.fn,sourceError:first.sourceError,sourceAssociationVersion,sourceHTMLHash:hash(first.capture.flowHTML),comparison:second?comparison(first.capture,second.capture):null};
 await saveJSON(join(output,'capture.json'),meta);captures.set(key(item.id,mode),meta);
}
async function drain(){
 if(working)return;working=true;
 try{while(queue.length&&!closing){const job=queue.shift();active=key(job.id,job.mode);try{await render(byId.get(job.id),job.mode,job.repeat);delete errors[active];console.log(`Review image ready: ${humanIds.get(job.id)} ${active}`);}catch(error){errors[active]=error.message;console.error(active,error);}finally{queued.delete(active);active=null;}}}finally{working=false;}
}
function enqueue(id,mode,repeat=false){const jobKey=key(id,mode);if(queued.has(jobKey))return;queued.add(jobKey);queue.push({id,mode,repeat});void drain();}
function summary(item){return {id:item.id,reviewId:humanIds.get(item.id),provenance:item.provenance,inputKind:item.input.kind,selection:item.selection,panel:item.panel,viewport:item.viewport,limitations:item.limitations,feedbackReason:knownFailures.get(item.id)??null,recommendation:item.limitations.length?'Coverage limitation: inspect original fixture and graph-only/state presentation.':null,artifacts:Object.fromEntries(['development','production'].map(mode=>[mode,captures.has(key(item.id,mode))])),review:reviews[item.id]??{status:'unreviewed',note:''}};}
// Import only explicit exploratory partial runs, never consider them certified.
for(let index=0;index<args.length;index++)if(args[index]==='--import'){
 const source=resolve(args[++index]);
 for(const item of cases)for(const mode of ['development','production']){
  if(captures.has(key(item.id,mode)))continue;
  const original=item.artifacts[mode];const leaf=path=>join(source,mode,path.split('/').at(-1));
  if(!await exists(leaf(original.capture))||!await exists(leaf(original.html)))continue;
  const dest=directory(item.id,mode);await mkdir(dest,{recursive:true});
  // Historical screenshot metadata is optional; no PNG is read or required.
  const metadata=await readJSON(leaf(original.capture));
  await writeFile(join(dest,'flow.html'),await readFile(leaf(original.html)));
  const hasSVG=!metadata.svgAbsent&&!!original.svg&&await exists(leaf(original.svg));
  if(hasSVG)await writeFile(join(dest,'diagram.svg'),await readFile(leaf(original.svg)));
  const meta={caseHash:hash(JSON.stringify(item)),origin:'Imported partial recording — fallback extracted SVG, not isolated; not a baseline',createdAt:null,repeat:false,svg:hasSVG};
  await saveJSON(join(dest,'capture.json'),meta);captures.set(key(item.id,mode),meta);
 }
}
const publicRoot=fileURLToPath(new URL('./public/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
// Legacy repeat recordings lack an independent presence bit. Equal SVGs can
// establish absence; otherwise preserve an expected artifact (and report missing
// bytes as an error), never infer repeat absence from the first capture alone.
async function repeatSVGPresent(meta,folder){
 if(!meta.repeat)return false;
 if(typeof meta.repeatSVGPresence==='boolean')return meta.repeatSVGPresence;
 if(await exists(join(folder,'repeat.svg')))return true;
 return meta.comparison?.svg===true ? meta.svg!==false : true;
}
async function previewSVG(meta,folder,repeat){
 const present=repeat?await repeatSVGPresent(meta,folder):meta.svg;
 if(repeat&&!meta.repeat){const error=Error('No repeat capture available');error.code='ENOENT';throw error;}
 return present?await readFile(join(folder,repeat?'repeat.svg':'diagram.svg'),'utf8'):null;
}
function sendJSON(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>65536)throw Error('Request too large');}return JSON.parse(data||'{}');}
// These documents wrap the saved bytes verbatim: never parse/reserialize SVG.
const previewCSP = "sandbox allow-same-origin; default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'self'";
function sendAsset(res,content,type,csp){res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(csp?{'Content-Security-Policy':csp}:{})});res.end(content);}
async function renderAsset(pathname,res){
 if(pathname==='/render-style.css'){
  const css=await readFile(join(root,'apps/editor/src/style.css'),'utf8');
  // Only the review stylesheet's external font URL changes, never saved SVG.
  return sendAsset(res,css.replace(/https:\/\/fonts\.googleapis\.com\/[^'"\s)]+/g,'/render-fonts.css'),'text/css; charset=utf-8');
 }
 const archive=await reviewFonts();
 if(pathname==='/render-fonts.css'){
  const entry=Object.entries(archive.lock.entries).find(([url])=>url.startsWith('https://fonts.googleapis.com/'));
  if(!entry)throw Error('Missing archived font stylesheet');
  let css=await readFile(join(root,fontDirectory,entry[1].sha256),'utf8');
  for(const [url,font] of Object.entries(archive.lock.entries))css=css.split(url).join(`/render-font/${font.sha256}`);
  return sendAsset(res,css,'text/css; charset=utf-8');
 }
 const sha=pathname.slice('/render-font/'.length);
 const entry=Object.values(archive.lock.entries).find(font=>font.sha256===sha);
 if(!entry)return sendJSON(res,{error:'Unknown archived font'},404);
 return sendAsset(res,await readFile(join(root,fontDirectory,sha)),entry.contentType??'application/octet-stream');
}
const server=createServer(async(req,res)=>{
 try{
  // Reject DNS rebinding and cross-origin mutation on this loopback-only server.
  const allowedHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
  if(!allowedHosts.includes(req.headers.host))return sendJSON(res,{error:'Foreign host'},403);
  if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return sendJSON(res,{error:'Foreign origin'},403);
  const url=new URL(req.url,'http://localhost');const mode=url.searchParams.get('mode')??'development';
  if(!['development','production'].includes(mode))return sendJSON(res,{error:'Unknown mode'},400);
  if(req.method==='GET'&&(/^\/render-font\/[a-f0-9]{64}$/.test(url.pathname)||['/render-style.css','/render-fonts.css'].includes(url.pathname)))return await renderAsset(url.pathname,res);
  if(req.method==='GET'&&url.pathname==='/api/cases')return sendJSON(res,{cases:cases.map(summary)});
  if(req.method==='GET'&&url.pathname==='/api/feedback')return sendJSON(res,{version:1,exportedAt:new Date().toISOString(),reviews:cases.map(item=>({id:item.id,reviewId:humanIds.get(item.id),...summary(item).review}))});
  if(req.method==='GET'&&url.pathname==='/api/status')return sendJSON(res,{active,queued:queue.map(job=>key(job.id,job.mode)),errors});
  if(req.method==='POST'&&url.pathname==='/api/capture-all'){
   const input=await body(req);if(!['development','production'].includes(input.mode))return sendJSON(res,{error:'Unknown mode'},400);
   for(const item of cases)if(captures.get(key(item.id,input.mode))?.pipeline!==pipeline)enqueue(item.id,input.mode,input.repeat===true);
   return sendJSON(res,{queued:true});
  }
  const match=url.pathname.match(/^\/api\/cases\/([^/]+)(?:\/(capture|review))?$/);
  if(match){
   const id=decodeURIComponent(match[1]);const item=byId.get(id);if(!item)return sendJSON(res,{error:'Unknown case'},404);
   if(req.method==='POST'&&match[2]==='capture'){
    const input=await body(req);if(!['development','production'].includes(input.mode))return sendJSON(res,{error:'Unknown mode'},400);enqueue(id,input.mode,input.repeat!==false);return sendJSON(res,{queued:true});
   }
   if(req.method==='POST'&&match[2]==='review'){
    const input=await body(req);if(!['unreviewed','looks-good','needs-work'].includes(input.status)||typeof input.note!=='string'||input.note.length>20000)return sendJSON(res,{error:'Invalid feedback'},400);
    feedbackWrites = feedbackWrites.catch(()=>{}).then(async()=>{
     reviews[id]={status:input.status,note:input.note,reviewId:humanIds.get(id),updatedAt:new Date().toISOString()};
     await saveJSON(join(storage,'reviews.json'),reviews);
    });
    await feedbackWrites;return sendJSON(res,reviews[id]);
   }
   if(req.method==='GET'&&!match[2]){
    let meta=captures.get(key(id,mode));let fn=null,sourceError=null;
    try{const associated=await captureSource(item,mode,meta);fn=associated.fn;sourceError=associated.sourceError;meta=captures.get(key(id,mode));}catch(error){sourceError=`Source association failed: ${error.message}`;}
    const files={...item.input.files};for(const action of item.actions??[])if(action.type==='write')files[action.file]=action.text;
    const base=`/images/${humanIds.get(id)}/${mode}`;
    const repeatPresent=meta?await repeatSVGPresent(meta,directory(id,mode)):false;
    return sendJSON(res,{case:summary(item),files,function:fn?{text:fn.text,file:fn.source?.file,name:fn.entry?.name}:null,synthetic:item.input.kind==='synthetic'?item.input:null,sourceError,capture:meta?{format:'svg',pipeline:meta.pipeline??'legacy-extracted-svg',imageUrl:`${base}/preview.html`,repeatImageUrl:meta.repeat?`${base}/repeat-preview.html`:undefined,svgUrl:meta.svg?`${base}/diagram.svg`:undefined,repeatSVGPresent:repeatPresent,repeatSvgUrl:repeatPresent?`${base}/repeat.svg`:undefined,htmlUrl:`${base}/flow.html`,origin:meta.pipeline===pipeline?meta.origin:`${meta.origin} — fallback extracted SVG, not isolated`,createdAt:meta.createdAt,comparison:meta.comparison}:null,review:reviews[id]??{status:'unreviewed',note:''}});
   }
  }
  const preview=url.pathname.match(/^\/images\/(FR-[A-F0-9]{10})\/(development|production)\/(preview\.html|repeat-preview\.html)$/);
  if(req.method==='GET'&&preview){
   const folder=join(storage,'captures',preview[1],preview[2]);
   const meta=await readJSON(join(folder,'capture.json'));
   const svg=await previewSVG(meta,folder,preview[3]==='repeat-preview.html');
   const label=meta.pipeline===pipeline?'Isolated SVG':'Fallback extracted SVG — not isolated';
   const content=`<!doctype html><html><head><meta charset="utf-8"><title>${label}</title><link rel="stylesheet" href="/render-style.css"></head><body><main class="flow-view"><p>${label}</p>${svg??'<p>SVG absent for this capture. No diagram preview is available.</p>'}<p><a href="flow.html" target="_blank">Actual captured editor HTML (separate integration artifact)</a></p></main></body></html>`;
   return sendAsset(res,content,'text/html; charset=utf-8',previewCSP);
  }
  const image=url.pathname.match(/^\/images\/(FR-[A-F0-9]{10})\/(development|production)\/(diagram\.svg|repeat\.svg|flow\.html)$/);
  let path;
  if(image)path=join(storage,'captures',image[1],image[2],image[3]);
  else if(['/','/index.html','/app.js','/style.css'].includes(url.pathname))path=join(publicRoot,url.pathname==='/'?'index.html':url.pathname.slice(1));
  else return sendJSON(res,{error:'Not found'},404);
  const content=await readFile(path);const extension=path.slice(path.lastIndexOf('.'));
  res.writeHead(200,{'Content-Type':mime[extension]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(image?{'Content-Security-Policy':previewCSP}:{})});res.end(content);
 }catch(error){sendJSON(res,{error:error.message},error.code==='ENOENT'?404:500);}
});
await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});
console.log(`Flow review: http://127.0.0.1:${server.address().port}`);
console.log(`${cases.length} unique cases; feedback stored in ${storage}/reviews.json; no baseline writes.`);
for(const id of knownFailures.keys()){const meta=captures.get(key(id,'development'));if(meta?.pipeline!==pipeline||!meta.repeat)enqueue(id,'development',true);}
if(args.includes('--capture-all'))for(const item of cases)if(captures.get(key(item.id,'development'))?.pipeline!==pipeline)enqueue(item.id,'development');
async function close(){if(closing)return;closing=true;server.close();for(const child of children)child.kill('SIGTERM');await browser?.close();await rm(scratch,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);

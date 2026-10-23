import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompiler } from '../src/index.ts';
import { validateResponse } from '../src/protocol.ts';

class WorkerStub extends EventTarget {
  static instances = [];
  listeners = new Map();
  terminated = false;
  constructor() { super(); WorkerStub.instances.push(this); }
  addEventListener(type, listener, options) { this.listeners.set(type, listener); super.addEventListener(type, listener, options); }
  removeEventListener(type, listener, options) { this.listeners.delete(type); super.removeEventListener(type, listener, options); }
  postMessage(value) { this.request = value; }
  terminate() { this.terminated = true; }
  respond(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
const valid = { kind: 'result', operation: 'check', result: { diagnostics: [] } };
test('per-request workers clean up on success, failure, cancellation and posting failure', async () => {
  const original = globalThis.Worker; globalThis.Worker = WorkerStub;
  try {
    const compiler = createCompiler(); assert.equal(WorkerStub.instances.length, 0);
    await assert.rejects(compiler.check({}, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(WorkerStub.instances.length, 0);
    for (const action of [w => w.respond(valid), w => w.respond({ kind: 'failure', message: 'runtime failed' }), w => w.respond({ kind: 'result', operation: 'check', result: { diagnostics: null } }), w => w.dispatchEvent(new Event('error')), w => w.dispatchEvent(new Event('messageerror')), (w, controller) => controller.abort()]) {
      const controller = new AbortController();
      const pending = compiler.check({ 'main.bal': '' }, controller.signal);
      const w = WorkerStub.instances.at(-1);
      action(w, controller);
      await pending.catch(() => {});
      assert.equal(w.terminated, true); assert.equal(w.listeners.size, 0);
      w.respond(valid); // A late success cannot settle an aborted/failed request.
    }
    const first = new AbortController();
    const cancelled = compiler.check({}, first.signal).catch(e => e.name);
    const second = compiler.check({});
    first.abort(); WorkerStub.instances.at(-1).respond(valid);
    assert.equal(await cancelled, 'AbortError'); assert.deepEqual(await second, valid.result);
    WorkerStub.prototype.postMessage = () => { throw Error('clone failed'); };
    await assert.rejects(compiler.check({}), /clone failed/);
    assert.equal(WorkerStub.instances.at(-1).listeners.size, 0);
    assert.equal(WorkerStub.instances.at(-1).terminated, true);
  } finally { globalThis.Worker = original; }
});
test('transport validates severities, ranges, coordinates and diagnostic fields', () => {
  for (const response of [null, {}, {kind:'failure',message:0}, ...[null, {}, {severity:'unknown',message:''}, {severity:'error',message:'',range:{start:{line:1,column:1},end:{line:1,column:2}}}, {severity:'error',message:'',file:'x',range:{start:{line:0,column:1},end:{line:1,column:2}}}, {severity:'error',message:'',file:'x',range:{start:{line:2,column:1},end:{line:1,column:2}}}].map(d => ({kind:'result',operation:'check',result:{diagnostics:[d]}}))]) {
    assert.throws(() => validateResponse(response), /Invalid compiler response/);
  }
  for (const severity of ['internal','hint','info','warning','error','fatal']) {
    const response = {kind:'result',operation:'check',result:{diagnostics:[{severity,message:'message'}]}};
    assert.deepEqual(validateResponse(response), response);
  }
});

test('analysis validates source bounds, identities, targets and operation; cancellation leaves checking independent', async () => {
  const original=globalThis.Worker; globalThis.Worker=WorkerStub; const post=WorkerStub.prototype.postMessage;
  WorkerStub.prototype.postMessage=function(request){this.request=request;};
  const located={id:'main',text:'x',source:{file:'main.bal',range:{start:{line:1,column:1},end:{line:1,column:2}}}};
  const result={kind:'valid',diagnostics:[],program:{scopes:[{...located,kind:'automation',title:'Automation',moduleId:'m',functionId:'main'}],functions:{main:{...located,moduleId:'m',entry:{kind:'function',name:'main',signature:'function main()',parameters:[],returnType:'()'},body:[]}}}};
  const response={kind:'result',operation:'analyze',result};
  try {
    const compiler=createCompiler();const promise=compiler.analyze({'main.bal':'x'});WorkerStub.instances.at(-1).respond(response);assert.deepEqual(await promise,result);
    for(const mutate of [r=>r.result.program.scopes.push(r.result.program.scopes[0]),r=>r.result.program.scopes[0].functionId='missing',r=>r.result.program.functions.main.source.range.end.column=3,r=>r.result.program.functions.main.text='bad',r=>r.result.program.functions.main.entry.kind='unknown',r=>r.result.program.functions.main.entry.parameters=[{kind:'query',text:'invented'}],r=>r.result.program.functions.main.entry.returnType=null,r=>r.operation='check']){
      const bad=structuredClone(response);mutate(bad);const pending=compiler.analyze({'main.bal':'x'});WorkerStub.instances.at(-1).respond(bad);await assert.rejects(pending);assert.ok(WorkerStub.instances.at(-1).terminated);
    }
    const cancel=new AbortController();const pending=compiler.analyze({'main.bal':'x'},cancel.signal).catch(e=>e.name);const check=compiler.check({});cancel.abort();WorkerStub.instances.at(-1).respond(valid);assert.equal(await pending,'AbortError');assert.deepEqual(await check,{diagnostics:[]});
  }finally{globalThis.Worker=original;WorkerStub.prototype.postMessage=post;}
});

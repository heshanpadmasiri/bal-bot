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
const valid = { kind: 'result', result: { diagnostics: [] } };
test('per-request workers clean up on success, failure, cancellation and posting failure', async () => {
  const original = globalThis.Worker; globalThis.Worker = WorkerStub;
  try {
    const compiler = createCompiler(); assert.equal(WorkerStub.instances.length, 0);
    await assert.rejects(compiler.check({}, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(WorkerStub.instances.length, 0);
    for (const action of [w => w.respond(valid), w => w.respond({ kind: 'failure', message: 'runtime failed' }), w => w.respond({ kind: 'result', result: { diagnostics: null } }), w => w.dispatchEvent(new Event('error')), w => w.dispatchEvent(new Event('messageerror')), (w, controller) => controller.abort()]) {
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
  for (const response of [null, {}, {kind:'failure',message:0}, ...[null, {}, {severity:'unknown',message:''}, {severity:'error',message:'',range:{start:{line:1,column:1},end:{line:1,column:2}}}, {severity:'error',message:'',file:'x',range:{start:{line:0,column:1},end:{line:1,column:2}}}, {severity:'error',message:'',file:'x',range:{start:{line:2,column:1},end:{line:1,column:2}}}].map(d => ({kind:'result',result:{diagnostics:[d]}}))]) {
    assert.throws(() => validateResponse(response), /Invalid compiler response/);
  }
  for (const severity of ['internal','hint','info','warning','error','fatal']) {
    const response = {kind:'result',result:{diagnostics:[{severity,message:'message'}]}};
    assert.deepEqual(validateResponse(response), response);
  }
});

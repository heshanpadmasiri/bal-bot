import React from 'react';
import {createRoot} from 'react-dom/client';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
import {Editor} from '../../src/editor';
import {BrowserWorkspace, STORAGE_KEY} from '../../../../packages/browser-workspace/src/workspace';
import {createCompiler} from '../../../../packages/compiler/src/index';
import '../../src/style.css';
const windowState = window as any;
windowState.mountEditor = (files: Record<string,string>, models?: unknown[]) => {
  windowState.prompts = []; windowState.analysisRequests = []; windowState.controlAnalysis = false;
  const compiler = createCompiler();
  const store = new Map([[STORAGE_KEY, JSON.stringify(files)]]);
  const workspace = new BrowserWorkspace({getItem: k => store.get(k) ?? null, setItem: (k,v) => {store.set(k,v);}}, {
    compiler: {check: compiler.check, analyze: async (files, signal) => {
      if (!windowState.controlAnalysis) return compiler.analyze(files, signal);
      return new Promise((resolve, reject) => {windowState.analysisRequests.push({files, resolve, reject});});
    }},
    streamFn(model, context) {
      windowState.prompts.push(context.messages.filter(m => m.role === 'user').at(-1));
      const stream = createAssistantMessageEventStream();
      const message = {role:'assistant' as const, content:[{type:'text' as const,text:'Mock response'}], api:model.api, provider:model.provider, model:model.id, stopReason:'stop' as const, timestamp:Date.now(), usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      queueMicrotask(() => {stream.push({type:'done',reason:'stop',message});stream.end();});return stream;
    },
  });
  windowState.workspace = workspace;
  windowState.editorRoot ??= createRoot(document.getElementById('editor-root')!);
  windowState.editorRoot.render(<Editor key={Math.random()} workspace={workspace}/>);
};

const chosen = new URLSearchParams(location.search).get('example');
if (chosen) {
  const sources = import.meta.glob('/examples/**/*.{bal,toml}', {query: '?raw', import: 'default', eager: true}) as Record<string,string>;
  const prefix = `/examples/${chosen}/`;
  const files = Object.fromEntries(Object.entries(sources).filter(([path]) => path.startsWith(prefix)).map(([path, text]) => [path.slice(prefix.length), text]));
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => String(input) === '/api/session' ? Promise.resolve(Response.json({token:'local-harness'})) : String(input) === '/api/providers' ? Promise.resolve(Response.json([{id:'openai',connected:false,models:[]}])) : originalFetch(input,options);
  windowState.mountEditor(files);
}

import React from 'react';
import {createRoot} from 'react-dom/client';
import {createAssistantMessageEventStream, normalizeContext} from '@earendil-works/pi-ai';
import {Editor} from '../../src/editor';
import {loginProvider, getAccounts, models, streamBrowser} from '../../src/providers';
import {BrowserWorkspace, STORAGE_KEY} from '../../../../packages/browser-workspace/src/workspace';
import {createCompiler} from '../../../../packages/compiler/src/index';
import '../../src/style.css';
const windowState = window as any;
windowState.loginProvider = loginProvider;
windowState.getAccounts = getAccounts;
windowState.testProviderRequest = async (id: string) => {
  const model = models.getModels(id)[0];
  return (await streamBrowser(model, normalizeContext({messages: [{role: 'user', content: 'Hello', timestamp: Date.now()}]}))).result();
};
// Mutate catalog entries too: Editor selects its model again before every send.
windowState.setTestContextWindow = (size: number) => {
  for (const model of models.getModels('openai')) model.contextWindow = size;
};
windowState.mountEditor = (files: Record<string,string>, _models?: unknown[]) => {
  windowState.prompts = []; windowState.pendingResponses = []; windowState.holdResponses = false; windowState.analysisRequests = []; windowState.controlAnalysis = false;
  windowState.summaryRequests = []; windowState.pendingSummaries = []; windowState.holdSummaries = false; windowState.failSummaries = false; windowState.cancelledSummaries = 0;
  const compiler = createCompiler();
  const store = new Map([[STORAGE_KEY, JSON.stringify(files)]]);
  const workspace = new BrowserWorkspace({getItem: k => store.get(k) ?? null, setItem: (k,v) => {store.set(k,v);}}, {
    compiler: {check: compiler.check, analyze: async (files, signal) => {
      if (!windowState.controlAnalysis) return compiler.analyze(files, signal);
      return new Promise((resolve, reject) => {windowState.analysisRequests.push({files, resolve, reject});});
    }},
    streamFn(model, context, options) {
      const first = context.messages[0];
      const summary = first?.role === 'system' && typeof first.content === 'string' && first.content.startsWith('Summarize conversation data');
      if (summary) windowState.summaryRequests.push(context);
      else windowState.prompts.push(context.messages.filter(m => m.role === 'user').at(-1));
      const stream = createAssistantMessageEventStream();
      const message = {role:'assistant' as const, content:[{type:'text' as const,text:'Mock response'}], api:model.api, provider:model.provider, model:model.id, stopReason:'stop' as const, timestamp:Date.now(), usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      if (summary) message.content[0].text = 'Goal: finish the requested change. Earlier work is complete.';
      let settled = false;
      const finish = (reason: 'stop' | 'error' | 'aborted' = 'stop') => {
        if (settled) return;
        settled = true;
        options?.signal?.removeEventListener('abort', abort);
        if (reason === 'stop') stream.push({type:'done',reason,message});
        else stream.push({type:'error',reason,error:{...message,stopReason:reason,errorMessage:'Controlled summary failure'}});
        stream.end();
      };
      const abort = () => {if (summary && !settled) windowState.cancelledSummaries++; finish('aborted');};
      if (summary) {
        options?.signal?.addEventListener('abort', abort, {once:true});
        if (options?.signal?.aborted) abort();
        else if (windowState.holdSummaries) windowState.pendingSummaries.push(() => finish(windowState.failSummaries ? 'error' : 'stop'));
        else queueMicrotask(() => finish(windowState.failSummaries ? 'error' : 'stop'));
      } else if (windowState.holdResponses) windowState.pendingResponses.push(() => finish());
      else queueMicrotask(() => finish());
      return stream;
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
  windowState.mountEditor(files);
}

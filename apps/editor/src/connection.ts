import { createAssistantMessageEventStream, type Model, type Api, type AssistantMessage, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface ProviderAccount {
  id: string;
  connected: boolean;
  models: Model<Api>[];
}
export interface LoginPrompt {
  id: string;
  type: 'select' | 'manual_code' | 'text' | 'secret';
  message: string;
  placeholder?: string;
  options?: { id: string; label: string }[];
}
export interface LoginState {
  id: string;
  provider: string;
  status: 'pending' | 'complete' | 'cancelled' | 'error';
  events: { type: string; url?: string; instructions?: string; message?: string }[];
  prompt?: LoginPrompt;
  error?: string;
}

let session: Promise<string> | undefined;
async function sessionToken(): Promise<string> {
  if (!session) session = fetch('/api/session').then(async response => {
    if (!response.ok) throw new Error('Could not connect to the local server.');
    return (await response.json()).token as string;
  }).catch(error => { session = undefined; throw error; });
  return session;
}

export async function api(path: string, method = 'GET', value?: unknown, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Bal-Bot-Session': await sessionToken() },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal,
  });
  if (!response.ok) {
    if (response.status === 401) session = undefined;
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response;
}

export const streamServer: StreamFn = (model, context, options) => {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    try {
      const response = await api('stream', 'POST', { provider: model.provider, modelId: model.id, context, sessionId: options?.sessionId }, options?.signal);
      if (!response.body) throw new Error('The server returned an empty stream.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AssistantMessageEvent;
          stream.push(event);
          if (event.type === 'done' || event.type === 'error') terminal = true;
        }
        if (done) break;
      }
      if (!terminal) throw new Error('The connection ended before the response completed. Try again.');
    } catch (error) {
      if (!terminal) {
        const aborted = options?.signal?.aborted;
        const message: AssistantMessage = {
          role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: aborted ? 'aborted' : 'error', errorMessage: aborted ? 'Request stopped.' : error instanceof Error ? error.message : 'Connection failed.', timestamp: Date.now(),
        };
        stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
      }
    } finally { await reader?.cancel().catch(() => {}); }
  })();
  return stream;
};

import type { BrowserWorkspace } from './workspace.ts';
import type { ServerMessage } from '@bal-bot/workspace/sync';

export interface SyncConnectionOptions {
  workspace: BrowserWorkspace;
  connect: () => Promise<WebSocket>;
  retryMs?: number;
  timeoutMs?: number;
}
export interface SyncController { start(): void; close(): void; }

export function createWorkspaceSync({ workspace, connect, retryMs = 500, timeoutMs = 30_000 }: SyncConnectionOptions): SyncController {
  let stopped = true;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let connecting = false;
  let initialized = false;
  let recovering = true;
  let inFlight: string | undefined;
  let sentAt = 0;
  let receivedAt = 0;
  let epoch = '';
  let revision = 0;
  let error: string | undefined;
  let retryOperationAt = 0;
  let attempts = 0;

  function update() {
    if (!initialized || stopped) return;
    const pending = workspace.pendingOperations();
    if (!pending.length && !error) recovering = false;
    workspace.setSyncState({ status: error ? 'error' : pending.length ? 'syncing' : 'synced', writable: !recovering && !error, error });
    if (pending.length && !inFlight && socket?.readyState === 1 && Date.now() >= retryOperationAt) {
      inFlight = pending[0].operationId;
      sentAt = Date.now();
      socket.send(JSON.stringify({ type: 'mutate', operation: pending[0] }));
    }
  }
  const scheduleUpdate = () => { queueMicrotask(() => { try { update(); } catch (cause) { fail(cause); } }); };
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Workspace synchronization failed.';
    workspace.setSyncState({ status: 'error', writable: false, error });
    socket?.close();
  }
  function disconnected(current: WebSocket) {
    if (socket !== current) return;
    socket = undefined;
    initialized = false;
    recovering = true;
    inFlight = undefined;
    if (stopped) return;
    workspace.setSyncState({ status: error ? 'error' : 'disconnected', writable: false, error });
    retry = setTimeout(() => { void open(); }, Math.min(retryMs * 2 ** attempts++, 10_000));
  }
  function receive(data: string) {
    const message = JSON.parse(data) as ServerMessage;
    receivedAt = Date.now();
    if (message.type === 'snapshot') {
      if (message.projectId !== workspace.projectId) throw new Error('The server project changed. Reload to open its workspace.');
      workspace.applyServerSnapshot(message.files);
      epoch = message.epoch; revision = message.revision;
      initialized = true; attempts = 0; error = undefined;
    } else if (message.type === 'committed') {
      if (!initialized || message.epoch !== epoch || message.revision !== revision + 1) throw new Error('Workspace changes need to be reconciled. Reconnecting…');
      workspace.applyServerChange(message.change);
      revision = message.revision;
    } else if (message.type === 'ack') {
      if (message.operationId !== inFlight) throw new Error('Unexpected sync acknowledgment.');
      workspace.acknowledge(message.operationId);
      inFlight = undefined; error = undefined; retryOperationAt = 0;
    } else if (message.type === 'error') {
      error = message.message;
      // Keep the outbox intact; retry transient disk failures without enabling editing.
      if (message.operationId && message.operationId === inFlight) {
        inFlight = undefined;
        retryOperationAt = Date.now() + 2_000;
      }
    } else if (message.type === 'healthy') {
      error = undefined; retryOperationAt = 0;
    } else if (message.type !== 'heartbeat') throw new Error('Invalid sync message.');
    update();
  }
  async function open() {
    if (stopped || connecting) return;
    connecting = true;
    initialized = false; recovering = true; inFlight = undefined;
    workspace.setSyncState({ status: attempts ? 'disconnected' : 'connecting', writable: false });
    try {
      const current = await connect();
      if (stopped) { current.close(); return; }
      socket = current;
      receivedAt = Date.now();
      current.addEventListener('message', event => { if (socket === current) { try { receive(String(event.data)); } catch (cause) { fail(cause); } } });
      current.addEventListener('close', () => disconnected(current));
      current.addEventListener('error', () => { if (socket === current) { workspace.setSyncState({ status: 'disconnected', writable: false }); current.close(); } });
    } catch (cause) {
      if (!stopped) {
        workspace.setSyncState({ status: 'disconnected', writable: false, error: cause instanceof Error ? cause.message : 'Could not connect.' });
        retry = setTimeout(() => { void open(); }, Math.min(retryMs * 2 ** attempts++, 10_000));
      }
    } finally { connecting = false; }
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      if (workspace.loadError) { workspace.setSyncState({ status: 'error', writable: false, error: workspace.loadError }); return; }
      unsubscribe = workspace.subscribe(scheduleUpdate);
      watchdog = setInterval(() => {
        if (socket && (Date.now() - receivedAt > timeoutMs || (inFlight && Date.now() - sentAt > timeoutMs))) {
          workspace.setSyncState({ status: 'disconnected', writable: false });
          socket.close();
          disconnected(socket);
        } else scheduleUpdate();
      }, Math.min(1000, timeoutMs / 2));
      void open();
    },
    close() {
      stopped = true; clearTimeout(retry); clearInterval(watchdog); unsubscribe?.();
      socket?.close(); socket = undefined; initialized = false;
      workspace.setSyncState({ status: 'disconnected', writable: false });
    },
  };
}

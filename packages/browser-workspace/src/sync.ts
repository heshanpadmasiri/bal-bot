import type { BrowserWorkspace } from './workspace.ts';
import type { ServerMessage } from '@bal-bot/workspace/sync';

export interface SyncConnectionOptions {
  workspace: BrowserWorkspace;
  connect: () => Promise<WebSocket>;
  retryMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
}
export interface SyncController { start(): void; close(): void; setEnabled(enabled: boolean): void; }

export function createWorkspaceSync({ workspace, connect, retryMs = 500, timeoutMs = 30_000, enabled = true }: SyncConnectionOptions): SyncController {
  let stopped = true;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let connecting = false;
  let generation = 0;
  let detach: (() => void) | undefined;
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
    if (!initialized || stopped || !enabled) return;
    const pending = workspace.pendingOperations();
    if (!pending.length && !error) recovering = false;
    workspace.setSyncState({ status: error ? 'error' : pending.length ? 'syncing' : 'synced', writable: !recovering && !error, error });
    if (pending.length && !inFlight && socket?.readyState === 1 && Date.now() >= retryOperationAt) {
      inFlight = pending[0].operationId;
      sentAt = Date.now();
      socket.send(JSON.stringify({ type: 'mutate', operation: pending[0] }));
    }
  }
  const scheduleUpdate = () => {
    const scheduledGeneration = generation;
    queueMicrotask(() => {
      if (scheduledGeneration !== generation || stopped || !enabled) return;
      try { update(); } catch (cause) { fail(cause); }
    });
  };
  function fail(cause: unknown) {
    error = cause instanceof Error ? cause.message : 'Workspace synchronization failed.';
    workspace.setSyncState({ status: 'error', writable: false, error });
    socket?.close();
  }
  function disconnected(current: WebSocket) {
    if (socket !== current) return;
    detach?.(); detach = undefined;
    socket = undefined;
    initialized = false;
    recovering = true;
    inFlight = undefined;
    if (stopped || !enabled) return;
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
    if (stopped || !enabled || connecting) return;
    const connectionGeneration = ++generation;
    connecting = true;
    initialized = false; recovering = true; inFlight = undefined;
    workspace.setSyncState({ status: attempts ? 'disconnected' : 'connecting', writable: false });
    try {
      const current = await connect();
      if (stopped || !enabled || connectionGeneration !== generation) { current.close(); return; }
      socket = current;
      receivedAt = Date.now();
      const active = () => !stopped && enabled && connectionGeneration === generation && socket === current;
      const onMessage = (event: MessageEvent) => { if (active()) { try { receive(String(event.data)); } catch (cause) { fail(cause); } } };
      const onClose = () => { if (active()) disconnected(current); };
      const onError = () => { if (active()) { workspace.setSyncState({ status: 'disconnected', writable: false }); current.close(); } };
      current.addEventListener('message', onMessage);
      current.addEventListener('close', onClose);
      current.addEventListener('error', onError);
      detach = () => {
        current.removeEventListener('message', onMessage);
        current.removeEventListener('close', onClose);
        current.removeEventListener('error', onError);
      };
    } catch (cause) {
      if (!stopped && enabled && connectionGeneration === generation) {
        workspace.setSyncState({ status: 'disconnected', writable: false, error: cause instanceof Error ? cause.message : 'Could not connect.' });
        retry = setTimeout(() => { void open(); }, Math.min(retryMs * 2 ** attempts++, 10_000));
      }
    } finally { if (connectionGeneration === generation) connecting = false; }
  }
  function stopTransport() {
    generation++;
    clearTimeout(retry); clearInterval(watchdog);
    retry = undefined; watchdog = undefined;
    detach?.(); detach = undefined;
    const current = socket;
    socket = undefined; initialized = false; connecting = false;
    recovering = true; inFlight = undefined;
    error = undefined; retryOperationAt = 0; attempts = 0;
    current?.close();
  }
  function activate() {
    if (workspace.loadError) { workspace.setSyncState({ status: 'error', writable: false, error: workspace.loadError }); return; }
    if (!enabled) { workspace.setSyncState({ status: 'paused', writable: true }); return; }
    watchdog = setInterval(() => {
      const current = socket;
      if (current && (Date.now() - receivedAt > timeoutMs || (inFlight && Date.now() - sentAt > timeoutMs))) {
        workspace.setSyncState({ status: 'disconnected', writable: false });
        current.close();
        disconnected(current);
      } else scheduleUpdate();
    }, Math.min(1000, timeoutMs / 2));
    void open();
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      unsubscribe = workspace.subscribe(scheduleUpdate);
      activate();
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (stopped) return;
      stopTransport();
      activate();
    },
    close() {
      stopped = true;
      stopTransport(); unsubscribe?.(); unsubscribe = undefined;
      workspace.setSyncState({ status: 'disconnected', writable: false });
    },
  };
}

import { WebSocketServer, WebSocket } from 'ws';

export function attachWorkspaceSync({ server, project, authorizeUpgrade, heartbeatMs = 10_000 }) {
  const sockets = new WebSocketServer({ noServer: true });
  const upgrade = (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/workspace-sync') return;
    if (!authorizeUpgrade(request, url.searchParams.get('ticket'))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  sockets.on('connection', ws => {
    let unsubscribe;
    let disposed = false;
    let alive = true;
    const send = message => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
    void project.connect(send).then(stop => { if (disposed) stop(); else unsubscribe = stop; }).catch(error => { send({ type: 'error', message: error.message }); ws.close(); });
    ws.on('message', (bytes, binary) => {
      try {
        if (disposed) return;
        if (binary) throw new Error('Expected a JSON sync message.');
        const message = JSON.parse(bytes.toString());
        if (message.type !== 'mutate') throw new Error('Unknown sync message.');
        // Enqueue on receipt, across all clients, rather than after an earlier ack.
        void project.apply(message.operation)
          .then(() => send({ type: 'ack', operationId: message.operation.operationId }))
          .catch(error => send({ type: 'error', message: error.message, operationId: message.operation?.operationId }));
      } catch (error) { send({ type: 'error', message: error.message }); }
    });
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      ws.ping();
      send({ type: 'heartbeat' });
    }, heartbeatMs);
    heartbeat.unref();
    ws.on('close', () => { disposed = true; clearInterval(heartbeat); unsubscribe?.(); });
    ws.on('error', () => { ws.terminate(); });
  });
  return {
    async close() {
      server.off('upgrade', upgrade);
      for (const ws of sockets.clients) ws.terminate();
      await new Promise(resolve => sockets.close(resolve));
    },
  };
}

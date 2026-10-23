// Local-server connections are exclusively for project metadata and file sync.
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

export async function connectWorkspace(): Promise<WebSocket> {
  const { ticket } = await (await api('sync-ticket', 'POST')).json();
  const url = new URL('/api/workspace-sync', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return new WebSocket(url);
}

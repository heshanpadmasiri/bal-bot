import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Workspace, Service, Anchor, Agent, AgentMessage } from '@bal-bot/workspace';
import { Accounts } from './accounts';
import { api, type ProviderAccount } from './connection';
import { FileTree } from './file-tree';

function messageText(message: AgentMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map(part => {
    if (part.type === 'text') return part.text;
    if (part.type === 'toolCall') return `↳ ${part.name}\n${JSON.stringify(part.arguments, null, 2)}`;
    return '';
  }).filter(Boolean).join('\n');
}

export function Editor({ workspace }: { workspace: Workspace }) {
  const files = useSyncExternalStore(listener => workspace.subscribe(listener), () => workspace.snapshot());
  const [services, setServices] = useState<readonly Service[]>([]);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [loginRequest, setLoginRequest] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState(workspace.loadError ?? '');
  const agent = useRef<Agent | null>(null);
  const [newPath, setNewPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const activeFile = selected !== null && Object.hasOwn(files, selected) ? selected : null;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let disposed = false;
    void workspace.getServices().then(items => {
      if (!disposed) { setServices(items); setAnchor(items[0] ?? null); }
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [workspace]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    agent.current = null; setMessages([]); setBusy(false); setActivity('');
    if (anchor) void anchor.getAgent().then(current => {
      if (disposed) return;
      agent.current = current;
      const update = () => {
        setMessages([...current.state.messages, ...(current.state.streamingMessage ? [current.state.streamingMessage] : [])]);
        setBusy(current.state.isStreaming);
      };
      update();
      unsubscribe = current.subscribe(event => {
        update();
        if (event.type === 'tool_execution_start') setActivity(event.toolName);
        if (event.type === 'tool_execution_end' || event.type === 'agent_end') setActivity('');
      });
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; unsubscribe?.(); };
  }, [anchor]);

  async function refreshAccounts() {
    setAccounts(await (await api('providers')).json());
  }
  useEffect(() => { void refreshAccounts().catch(e => setError(String(e))); }, []);
  const providerModels = accounts.find(a => a.id === provider)?.models ?? [];
  const activeModel = providerModels.find(m => m.id === model) ?? providerModels[0];

  function openFile(path: string) {
    setSelected(path);
    setEditing(false);
    setDeletePending(false);
  }
  function attempt(action: () => void) {
    try { action(); setError(''); } catch (e) { setError(String(e)); }
  }
  async function send() {
    if (!prompt.trim() || busy || !anchor) return;
    if (!accounts.find(a => a.id === provider)?.connected || !activeModel) { setLoginRequest(value => value + 1); return; }
    setBusy(true); setError(''); setSelected(null);
    const input = prompt;
    setPrompt('');
    try {
      if (!agent.current) throw new Error('Workspace agent is not ready.');
      agent.current.state.model = activeModel;
      await agent.current.prompt(input);
      if (agent.current.state.errorMessage) setError(agent.current.state.errorMessage);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); setActivity(''); }
  }

  return <div className="app">
    <header><div className="brand"><img className="ballerina-logo" src="/ballerina.ico" alt="Ballerina logo" width="36" height="36" />bal-bot</div><Accounts accounts={accounts} provider={provider} busy={busy} chooseProvider={id => { setProvider(id); setModel(''); }} refresh={refreshAccounts} loginRequest={loginRequest} /></header>
    <div className="workspace">
      <aside id="workspace-sidebar" className={sidebarCollapsed ? 'collapsed' : ''}>
        <div className="sidebar-heading">{!sidebarCollapsed && <span className="section-title">WORKSPACE</span>}<button className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand workspace sidebar' : 'Collapse workspace sidebar'} title={sidebarCollapsed ? 'Expand workspace sidebar' : 'Collapse workspace sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar-content" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M7.5 3.5v13" /><path d={sidebarCollapsed ? 'm11 7 3 3-3 3' : 'm14 7-3 3 3 3'} /></svg></button></div>
        <div id="workspace-sidebar-content" className="sidebar-content" hidden={sidebarCollapsed}>
        <div className="project"><svg className="project-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg><span>http_service</span></div>
        {services.map((service, index) => <React.Fragment key={index}>
          <button className={`service ${selected === null && anchor === service ? 'selected' : ''}`} onClick={() => { setAnchor(service); setSelected(null); setEditing(false); }}><span className="service-icon">↗</span> {service.kind.toUpperCase()} service <span className="badge">{service.kind.toUpperCase()}</span></button>
          {service.getEndpoints().map((endpoint, endpointIndex) => <button key={endpointIndex} className={`service ${selected === null && anchor === endpoint ? 'selected' : ''}`} onClick={() => { setAnchor(endpoint); setSelected(null); setEditing(false); }}>{endpoint.title}</button>)}
        </React.Fragment>)}
        <div className="section-title file-heading">FILES<button aria-label="New file" onClick={() => setCreating(!creating)}>+</button></div>
        {creating && <form className="new-file" onSubmit={event => { event.preventDefault(); attempt(() => { if (Object.hasOwn(files, newPath)) throw new Error('File already exists'); workspace.write(newPath, ''); openFile(newPath); setNewPath(''); setCreating(false); }); }}><input aria-label="New file path" placeholder="folder/file.bal" value={newPath} onChange={e => setNewPath(e.target.value)} autoFocus /><button>Add</button></form>}
        <FileTree paths={workspace.list()} selected={selected} open={openFile} />
        <div className="aside-bottom"><span className="dot" /> Browser workspace<p>Files saved on this browser.<br />Conversations last for this tab.</p></div>
        </div>
      </aside>
      <main>
        <div className="main-bar"><div className="main-location"><div className="breadcrumb"><span className="muted">http_service / </span>{activeFile ?? 'HTTP service'}</div></div>{activeFile && <button className="back-to-chat" onClick={() => { setSelected(null); setEditing(false); }}>← Back to chat</button>}</div>
        {error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {activeFile ? <section className="file-view">
          <div className="file-toolbar"><span>{activeFile} <small>{files[activeFile].split('\n').length} lines</small></span><div>{editing ? <><button onClick={() => { setEditing(false); }}>Cancel</button><button className="primary" onClick={() => attempt(() => { workspace.write(activeFile, draft); setEditing(false); })}>Save</button></> : <button onClick={() => { setDraft(files[activeFile]); setEditing(true); }}>Edit file</button>}<button onClick={() => setDeletePending(!deletePending)}>Delete</button></div></div>
          {deletePending && <div className="delete-confirm">Delete {activeFile}? <button onClick={() => attempt(() => { workspace.remove(activeFile); setSelected(null); setDeletePending(false); })}>Confirm delete</button><button onClick={() => setDeletePending(false)}>Cancel</button></div>}
          {editing ? <textarea className="code-editor" aria-label={`Edit ${activeFile}`} value={draft} spellCheck={false} onChange={e => setDraft(e.target.value)} /> : <div className="source"><div className="line-numbers" aria-hidden="true">{files[activeFile].split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}</div><pre aria-label={`Contents of ${activeFile}`}>{files[activeFile]}</pre></div>}
        </section> : <>
          <div className="conversation" ref={element => { if (element) element.scrollTop = element.scrollHeight; }}>
            {messages.filter(m => m.role !== 'system').length === 0 && <div className="welcome"><span className="welcome-icon">↗</span><div className="eyebrow">YOUR SERVICE STARTS HERE</div><h1>What shall we build?</h1><p>An empty Ballerina HTTP service is ready.<br />Describe a change and PI will edit your workspace files.</p><button className="suggestion" onClick={() => setPrompt('Add a GET /hello endpoint that returns "Hello, world!".')}>Add a hello world endpoint <span>↗</span></button></div>}
            {messages.filter(m => m.role !== 'system').map((message, i) => <article key={i} className={`message ${message.role}`}><div className="message-label">{message.role === 'user' ? 'You' : message.role === 'toolResult' ? message.toolName : 'bal-bot'}</div><pre>{messageText(message)}</pre>{message.role === 'assistant' && message.errorMessage && <p className="message-error">{message.errorMessage}</p>}</article>)}
          </div>
          <div className="composer-area">{busy && <div className="activity" role="status"><span className="dot" />{activity || 'PI is working…'}</div>}<form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea aria-label="Message PI" placeholder="Describe a change to your service…" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><div className="composer-bottom"><label className="composer-model"><span className="sr-only">Model</span><select aria-label="Model" value={activeModel?.id ?? ''} disabled={busy || !providerModels.length} onChange={e => setModel(e.target.value)}>{!providerModels.length && <option value="">Loading models…</option>}{providerModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{busy ? <button type="button" onClick={() => agent.current?.abort()}>Stop ■</button> : <button className="send" aria-label="Send message" disabled={!prompt.trim()} type="submit">↑</button>}</div></form><p className="composer-hint">PI can edit all workspace files. Source editing and diagnostics.</p></div>
        </>}
      </main>
    </div>
  </div>;
}


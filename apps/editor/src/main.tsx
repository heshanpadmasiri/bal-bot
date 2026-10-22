import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './editor';
import { api, streamServer, connectWorkspace } from './connection';
import { BrowserWorkspace, createWorkspaceSync } from '@bal-bot/browser-workspace';
import './style.css';

function App() {
  const [workspace, setWorkspace] = useState<BrowserWorkspace>();
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    let sync: ReturnType<typeof createWorkspaceSync> | undefined;
    async function open() {
      try {
        const project = await (await api('project')).json();
        if (disposed) return;
        const current = new BrowserWorkspace({
          getItem: key => window.localStorage.getItem(key),
          setItem: (key, value) => window.localStorage.setItem(key, value),
        }, { streamFn: streamServer, projectId: project.id, projectName: project.name });
        sync = createWorkspaceSync({ workspace: current, connect: connectWorkspace });
        setWorkspace(current); sync.start();
      } catch (cause) {
        if (!disposed) { setError(String(cause)); retry = setTimeout(() => { void open(); }, 1000); }
      }
    }
    void open();
    return () => { disposed = true; clearTimeout(retry); sync?.close(); };
  }, []);
  return workspace ? <Editor workspace={workspace} /> : <div className="connecting" role="status">Connecting to workspace…{error && <p>{error}</p>}</div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

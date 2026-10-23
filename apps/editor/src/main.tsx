import { createCompiler } from '@bal-bot/compiler';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, type FileSyncControl } from './editor';
import { api, streamServer, connectWorkspace } from './connection';
import { BrowserWorkspace, createWorkspaceSync } from '@bal-bot/browser-workspace';
import './style.css';

function App() {
  const [workspace, setWorkspace] = useState<BrowserWorkspace>();
  const [error, setError] = useState('');
  const [syncControl, setSyncControl] = useState<FileSyncControl>();
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
        }, { streamFn: streamServer, compiler: createCompiler(), projectId: project.id, projectName: project.name });
        const preferenceKey = `bal-bot.file-sync.v1.${project.id}`;
        const enabled = window.sessionStorage.getItem(preferenceKey) !== 'false';
        const controller = createWorkspaceSync({ workspace: current, connect: connectWorkspace, enabled });
        sync = controller;
        const setEnabled = (next: boolean) => {
          // Persist first: a failed preference write leaves the current mode intact.
          window.sessionStorage.setItem(preferenceKey, String(next));
          controller.setEnabled(next);
          setSyncControl({ enabled: next, setEnabled });
        };
        setSyncControl({ enabled, setEnabled });
        controller.start(); setWorkspace(current);
      } catch (cause) {
        if (!disposed) { setError(String(cause)); retry = setTimeout(() => { void open(); }, 1000); }
      }
    }
    void open();
    return () => { disposed = true; clearTimeout(retry); sync?.close(); };
  }, []);
  return workspace ? <Editor workspace={workspace} syncControl={syncControl} /> : <div className="connecting" role="status">Connecting to workspace…{error && <p>{error}</p>}</div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

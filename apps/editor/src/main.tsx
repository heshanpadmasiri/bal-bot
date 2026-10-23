import { createCompiler } from '@bal-bot/compiler';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './editor';
import { streamServer } from './connection';
import { BrowserWorkspace } from '@bal-bot/browser-workspace';
import './style.css';

function App() {
  const [workspace] = useState(() => new BrowserWorkspace({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }, { streamFn: streamServer, compiler: createCompiler(), projectName: 'Hello World' }));
  return <Editor workspace={workspace} />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

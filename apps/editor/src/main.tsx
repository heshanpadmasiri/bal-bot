import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './editor';
import { streamServer } from './connection';
import { BrowserWorkspace } from '@bal-bot/browser-workspace';
import './style.css';

const workspace = new BrowserWorkspace({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
}, { streamFn: streamServer });

createRoot(document.getElementById('root')!).render(<React.StrictMode><Editor workspace={workspace} /></React.StrictMode>);

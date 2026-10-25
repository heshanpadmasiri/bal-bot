import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createCompiler } from '@bal-bot/compiler';
import { decodeDemo, type Demo } from './demo-link';
import { Playground } from './playground';
import '../../editor/src/style.css';
import './style.css';

const defaultDemo: Demo = {version: 1, source: `function main() {
    int count = 3;
    if count > 0 {
        count -= 1;
    } else {
        count = 1;
    }
}
`};
const compiler = createCompiler();
function App(): React.JSX.Element {
  const [fragment, setFragment] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => setFragment(window.location.hash);
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const link = decodeDemo(fragment);
  return <Playground key={fragment} compiler={compiler} initial={link.kind === 'valid' ? link.demo : defaultDemo}
    initialLinkError={link.kind === 'invalid' ? link.message : undefined}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

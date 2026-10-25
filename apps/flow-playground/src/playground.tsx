import React, { useState } from 'react';
import type { Compiler } from '@bal-bot/compiler';
import { FlowView } from '../../editor/src/flow-view';
import { encodeDemo, type Demo } from './demo-link';
import { usePlayground } from './use-playground';

export function Playground({compiler, initial, initialLinkError}: {
  compiler: Compiler; initial: Demo; initialLinkError?: string;
}): React.JSX.Element {
  const state = usePlayground(compiler, initial);
  const [copyStatus, setCopyStatus] = useState('');
  const analysis = state.analysis;
  async function copyLink(): Promise<void> {
    try {
      const url = encodeDemo(window.location.href, {version: 1, source: state.source,
        ...(state.selectedFunction ? {functionId: state.selectedFunction} : {})});
      await navigator.clipboard.writeText(url);
      setCopyStatus('Demo link copied. Anyone with this link can read the source.');
    } catch {
      setCopyStatus('Could not copy the demo link. Check clipboard permissions and try again.');
    }
  }
  return <div className="playground app">
    <header><div><h1>Flow playground</h1><p>Edit Ballerina. See its flow.</p></div><button onClick={() => { void copyLink(); }}>Copy demo link</button></header>
    {initialLinkError && <div className="playground-error" role="alert">{initialLinkError} Showing the default example.</div>}
    {copyStatus && <div className="playground-status" role="status">{copyStatus}</div>}
    <div className="playground-panes">
      <section className="playground-source" aria-label="Source editor">
        <div className="playground-toolbar"><label htmlFor="source">main.bal</label><span>Updates after a typing pause</span></div>
        <p className="playground-help" id="source-help">Use a complete .bal file. Wrap statements in a function and include required imports and declarations.</p>
        <textarea id="source" aria-label="Ballerina source" aria-describedby="source-help" value={state.source}
          onChange={event => { state.setSource(event.target.value); setCopyStatus(''); }} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      </section>
      <section className="inspection playground-flow" aria-label="Flow preview">
        <div className="playground-toolbar"><label htmlFor="entry">Entry</label><select id="entry" aria-label="Flow entry"
          value={state.entries.some(entry => entry.id === state.selectedFunction) ? state.selectedFunction : ''}
          disabled={!state.entries.length} onChange={event => state.selectFunction(event.target.value)}>
          {!state.entries.length && <option value="">No functions available</option>}
          {state.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select></div>
        {state.selectedFunction && state.entries.length > 0
          ? <FlowView flow={{state: analysis, selection: {kind: 'function', functionId: state.selectedFunction}}}
            references={[]} expanded={state.expanded} onToggle={state.toggleExpansion} onSelect={() => {}} onOpenFunction={state.selectFunction}/>
          : <div className="playground-empty">
            <p role="status">{analysis.kind === 'pending' ? 'Analyzing source…' : analysis.kind === 'failed' ? analysis.message
              : analysis.kind === 'invalid' ? 'Fix the source errors to see its flow.' : 'No functions or endpoints in this source.'}</p>
            {(analysis.kind === 'invalid' || analysis.kind === 'ready') && analysis.diagnostics.length > 0 && <ul className="flow-diagnostics">{analysis.diagnostics.map((d, i) => <li key={i}>{d.file}{d.range ? `:${d.range.start.line}` : ''}: {d.message}</li>)}</ul>}
          </div>}
      </section>
    </div>
  </div>;
}

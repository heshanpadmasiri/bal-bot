import React from 'react';
import type { HIREntry } from '@bal-bot/workspace';

/** HIR supplies entry context in display form; no scope search or title parsing. */
export function HIRFlowEntry({entry}: {entry: HIREntry}): React.JSX.Element {
  return <div className="flow-entry-context">
    {entry.owner !== null && <div className="flow-entry-owner">{entry.owner}</div>}
    <section className="flow-entry" aria-label={`${entry.kind} entry`}>
      <div className="flow-entry-heading"><div className="flow-entry-kind">{entry.kind}</div><h2>{entry.operation && <span className="flow-entry-operation">{entry.operation}</span>}{entry.name}</h2></div>
      <details><summary>Signature &amp; inputs</summary><code className="flow-entry-signature">{entry.signature}</code><dl>
        {entry.parameters.length ? entry.parameters.map((parameter, index) => <React.Fragment key={index}><dt>{parameter.label}</dt><dd>{parameter.text}</dd></React.Fragment>) : <><dt>Inputs</dt><dd>None</dd></>}
        <dt>Returns</dt><dd>{entry.returnType}</dd>
      </dl></details>
    </section>
  </div>;
}

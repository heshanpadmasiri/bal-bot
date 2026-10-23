import React from 'react';
import type { FunctionModel, ProgramModel } from '@bal-bot/workspace';

export function FlowEntry({fn, program}: {fn: FunctionModel; program: ProgramModel}): React.JSX.Element {
  const service = program.scopes.find(scope => scope.kind === 'service' && scope.endpoints.some(endpoint => endpoint.functionId === fn.id));
  const endpoint = service?.kind === 'service' ? service.endpoints.find(endpoint => endpoint.functionId === fn.id) : undefined;
  const title = endpoint?.title ?? fn.entry.name;
  const resource = fn.entry.kind === 'resource';
  const separator = title.indexOf(' ');
  const operation = resource && separator > 0 ? title.slice(0, separator) : undefined;
  const name = operation ? title.slice(separator + 1) : title;
  return <div className="flow-entry-context">
    {service?.kind === 'service' && <div className="flow-entry-owner">Service {service.title}{service.serviceType && !service.title.includes(service.serviceType) && <> · {service.serviceType}</>}</div>}
    <section className="flow-entry" aria-label={`${fn.entry.kind} entry`}>
      <div className="flow-entry-heading"><div className="flow-entry-kind">{fn.entry.kind}</div><h2>{operation && <span className="flow-entry-operation">{operation}</span>}{name}</h2></div>
      <details><summary>Signature &amp; inputs</summary><code className="flow-entry-signature">{fn.entry.signature}</code><dl>
        {fn.entry.parameters.length ? fn.entry.parameters.map((parameter, index) => <React.Fragment key={index}><dt>{parameter.kind === 'path' ? 'Path' : 'Input'}</dt><dd>{parameter.text}</dd></React.Fragment>) : <><dt>Inputs</dt><dd>None</dd></>}
        <dt>Returns</dt><dd>{fn.entry.returnType}</dd>
      </dl></details>
    </section>
  </div>;
}

// Vite-only alias retaining the real Editor/panel/actions until Stage 6.
import React from 'react';
import {HIRFlowView} from '../../src/hir-flow-view';
import {hirFlow} from './hir-model-registry';
export type {FlowViewProps} from '../../src/flow-view';
(window as any).flowParityComponent = HIRFlowView;
export function FlowView(props: any) {
  const {flow, graphOnly} = hirFlow(props.flow);
  return <HIRFlowView {...props} flow={flow} graphOnly={graphOnly}/>;
}

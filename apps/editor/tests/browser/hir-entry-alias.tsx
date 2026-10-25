// Synthetic graph fixtures have no entry declaration; do not fabricate one.
// This test-only omission matches the frozen GraphOnly mount before Stage 6.
import React from 'react';
import {HIRFlowEntry as Entry} from '../../src/hir-flow-entry?hir-direct';
export function HIRFlowEntry(props: any) {
  return !props.entry.name && !props.entry.signature ? null : <Entry {...props}/>;
}

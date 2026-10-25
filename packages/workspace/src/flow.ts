import type { SourceRange, Diagnostic } from './index.ts';

export type Id = string;
export type Revision = number;
export interface SourceReference { readonly file: string; readonly range: SourceRange; }
export interface Located { readonly id: Id; readonly source: SourceReference; readonly text: string; }
export type CallTarget = { readonly kind: 'workspace'; readonly functionId: Id }
  | { readonly kind: 'external'; readonly label: string };
export interface ReceiverContext {
  readonly receiver: Located;
  readonly type?: string;
  readonly origin: 'constructor' | 'initializer' | 'parameter' | 'unavailable';
  readonly initializer?: Located;
}
export interface ClientInvocation {
  readonly context: ReceiverContext;
  readonly method: string;
  readonly arguments: readonly Located[];
}
export interface Evaluation extends Located {
  readonly kind: 'source' | 'call' | 'check' | 'checkpanic' | 'trap' | 'template';
  readonly children: readonly Evaluation[];
  readonly call?: CallSite;
  readonly strings?: readonly string[];
}
export type CallSite = Located & { readonly client?: ClientInvocation } & ({ readonly target: { readonly kind: 'workspace'; readonly functionId: Id }; readonly expansion: 'supported' }
  | { readonly target: CallTarget; readonly expansion: 'unavailable'; readonly reason: string });
export interface Expression extends Located { readonly calls: readonly CallSite[]; readonly evaluation?: Evaluation; }
export type Statement = Located & { readonly evaluation?: Evaluation; readonly binding?: string } & (
  | { readonly kind: 'simple'; readonly operation: 'declare' | 'assign' | 'expression'; readonly presentation: 'step' | 'mapping'; readonly calls: readonly CallSite[] }
  | { readonly kind: 'return'; readonly calls: readonly CallSite[] }
  | { readonly kind: 'if'; readonly condition: Expression; readonly thenBody: readonly Statement[]; readonly elseBody: readonly Statement[] }
  | { readonly kind: 'while'; readonly condition: Expression; readonly body: readonly Statement[] }
  | { readonly kind: 'foreach'; readonly header: Expression; readonly body: readonly Statement[] }
  | { readonly kind: 'break' | 'continue' }
  | { readonly kind: 'unsupported'; readonly reason: string }
);
export interface FunctionEntry {
  readonly kind: 'resource' | 'remote' | 'function' | 'method';
  readonly name: string;
  readonly signature: string;
  readonly parameters: readonly { readonly kind: 'input' | 'path'; readonly text: string }[];
  readonly returnType: string;
}
export interface FunctionModel extends Located { readonly moduleId: Id; readonly entry: FunctionEntry; readonly body: readonly Statement[]; }
export type Definition = Located & ({ readonly kind: 'function'; readonly label: string; readonly functionId: Id }
  | { readonly kind: 'type' | 'connector' | 'configurable'; readonly label: string });
export interface EndpointModel extends Located {
  readonly kind: 'resource' | 'remote'; readonly title: string; readonly functionId: Id;
}
export type ScopeModel = Located & (
  | { readonly kind: 'service'; readonly title: string; readonly moduleId: Id; readonly serviceType: string | null;
      readonly endpoints: readonly EndpointModel[]; readonly definitions: readonly Definition[] }
  | { readonly kind: 'automation'; readonly title: 'Automation'; readonly moduleId: Id; readonly functionId: Id }
);
export interface ProgramModel {
  readonly scopes: readonly ScopeModel[]; readonly functions: Readonly<Record<Id, FunctionModel>>;
}
export type AnalysisResult = { readonly kind: 'valid'; readonly program: HIRProgram; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'invalid'; readonly diagnostics: readonly Diagnostic[] };
export type AnalysisState =
  | { readonly kind: 'pending'; readonly revision: Revision; readonly previous?: HIRProgram }
  | { readonly kind: 'ready'; readonly revision: Revision; readonly program: HIRProgram; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'invalid'; readonly revision: Revision; readonly previous?: HIRProgram; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'failed'; readonly revision: Revision; readonly previous?: HIRProgram; readonly message: string };
export interface FlowUI {
  readonly state: AnalysisState;
  readonly selection: { readonly kind: 'definitions'; readonly scopeId: Id }
    | { readonly kind: 'function'; readonly functionId: Id };
}

// HIR is the analyze wire model; legacy model exports remain during migration.
// See docs/hir-wire.md for identity, ordering, and nullability rules.
export interface HIRProgram {
  readonly scopes: readonly ScopeModel[];
  readonly sources: Readonly<Record<Id, Located>>;
  readonly functions: Readonly<Record<Id, HIRGraph>>;
}
export interface HIRGraph extends Located {
  readonly moduleId: Id;
  readonly entry: HIREntry;
  readonly nodes: readonly HIRNode[];
  readonly ports: readonly HIRPort[];
  readonly edges: readonly HIREdge[];
  readonly groups: readonly HIRGroup[];
  readonly rootGroup: Id;
  readonly interfaces: readonly HIRInterface[];
  readonly emission: { readonly root: HIREmissionPlan; readonly inline: HIREmissionPlan };
}
export interface HIREntry {
  readonly kind: 'resource' | 'remote' | 'function' | 'method';
  readonly owner: string | null;
  readonly operation: string | null;
  readonly name: string;
  readonly signature: string;
  readonly parameters: readonly { readonly label: 'Path' | 'Input'; readonly text: string }[];
  readonly returnType: string;
}
export interface HIRNode {
  readonly id: Id;
  readonly occurrenceKey: string;
  readonly sourceId: Id;
  readonly presentation: HIRPresentation;
  readonly body: HIRNodeBody;
}
export type HIRNodeBody = { readonly kind: 'leaf' }
  | { readonly kind: 'group'; readonly groupId: Id }
  | { readonly kind: 'reference'; readonly reference: HIRGraphReference };
export type HIRNodeStyle = 'step' | 'condition' | 'function' | 'loop' | 'mapping' | 'unsupported' | 'return' | 'client' | 'trap' | 'panic' | 'template';
export interface HIRLabelSection {
  readonly kind: 'text' | 'receiver' | 'context' | 'method';
  readonly text: string;
}
export type HIRPresentation = { readonly kind: 'hidden' }
  | { readonly kind: 'plain'; readonly style: HIRNodeStyle; readonly label: string; readonly sections: readonly HIRLabelSection[]; readonly limitation: string | null; readonly disclosure: HIRDisclosure }
  | { readonly kind: 'client'; readonly style: 'client'; readonly label: string; readonly sections: readonly HIRLabelSection[]; readonly limitation: string | null; readonly disclosure: HIRDisclosure };
export type HIRDisclosure = { readonly kind: 'none' }
  | { readonly kind: 'call'; readonly occurrenceKey: string; readonly availability: HIRAvailability; readonly recursive: HIRRecursivePresentation }
  | { readonly kind: 'client-context'; readonly occurrenceKey: string; readonly collapsed: HIRLabelContent; readonly expanded: HIRLabelContent; readonly expandedRecursive: HIRRecursivePresentation | null; readonly call: Extract<HIRDisclosure, { readonly kind: 'call' }> | null };
export interface HIRLabelContent { readonly label: string; readonly sections: readonly HIRLabelSection[]; }
export interface HIRRecursivePresentation {
  readonly label: string;
  readonly sections: readonly HIRLabelSection[];
  readonly limitation: string | null;
  readonly title: string;
  readonly ariaLabel: string;
  readonly glyph: string;
}
export type HIRAvailability = { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: string };
export type HIRPortRole = 'entry' | 'normal-exit' | 'true' | 'false' | 'return' | 'break' | 'continue' | 'next-iteration' | 'panic';
export type HIRAnchor = { readonly kind: 'top-center' | 'header-left' | 'header-right' | 'header-bottom-center' | 'bottom-center' | 'group-bottom-center' | 'iteration-marker' };
export interface HIRPort { readonly occurrenceKey: string; readonly id: Id; readonly nodeId: Id; readonly role: HIRPortRole; readonly anchor: HIRAnchor; }
export type HIREdgeKind = 'sequence' | 'true' | 'false' | 'back' | 'break' | 'continue' | 'return' | 'error' | 'panic';
export interface HIREdgeStyle {
  readonly kind: HIREdgeKind;
  readonly label: string | null;
  readonly routing: 'direct' | 'branch-left' | 'branch-right' | 'back';
}
export interface HIREdge extends HIREdgeStyle { readonly id: Id; readonly fromPort: Id; readonly toPort: Id; readonly when: HIRPresence; }
export interface HIRGroup {
  readonly id: Id;
  readonly arrangement: HIRArrangement;
  readonly style: HIRGroupStyle;
}
export type HIRArrangement = { readonly kind: 'sequence'; readonly members: readonly Id[] }
  | { readonly kind: 'columns'; readonly left: readonly Id[]; readonly right: readonly Id[] }
  | { readonly kind: 'container'; readonly members: readonly Id[] };
export interface HIRGroupVisibility { readonly node: boolean; readonly header: boolean; readonly container: boolean; }
export interface HIRGroupStyle {
  readonly profile: 'sequence' | 'if' | 'while' | 'foreach' | 'trap' | 'root' | 'call';
  readonly root: HIRGroupVisibility;
  readonly inline: HIRGroupVisibility;
}
export interface HIRInterface {
  readonly id: Id;
  readonly members: readonly { readonly portId: Id; readonly when: HIRPresence }[];
  readonly exports: readonly { readonly bindingId: Id; readonly beforeMember: number }[];
  readonly root: HIRRootTreatment;
}
export type HIRRootTreatment = { readonly kind: 'terminal' }
  | { readonly kind: 'connect'; readonly bindingId: Id; readonly toPort: Id; readonly edge: HIREdgeStyle };
export interface HIRGraphReference {
  readonly graphId: Id;
  readonly occurrenceKey: string;
  readonly availability: HIRAvailability;
  readonly container: HIRGroupStyle;
  readonly collapsed: { readonly interfaces: readonly HIRInterface[]; readonly edges: readonly HIREdge[] };
  readonly inline: readonly HIRBinding[];
}
export type HIRBinding = { readonly kind: 'entry'; readonly id: Id; readonly when: HIRPresence; readonly callerPortId: Id; readonly targetInterfaceId: Id; readonly edge: HIREdgeStyle }
  | { readonly kind: 'exit'; readonly id: Id; readonly when: HIRPresence; readonly targetInterfaceId: Id; readonly callerPortId: Id; readonly edge: HIREdgeStyle }
  | { readonly kind: 'export'; readonly id: Id; readonly when: HIRPresence; readonly targetInterfaceId: Id; readonly callerInterfaceId: Id };
export type HIRPresence = { readonly kind: 'constant'; readonly value: boolean }
  | { readonly kind: 'all' | 'any'; readonly operands: readonly HIRPresence[] }
  | { readonly kind: 'not'; readonly operand: HIRPresence }
  | { readonly kind: 'nonempty'; readonly referenceNodeId: Id; readonly interfaceId: Id };
export type HIREmission = { readonly kind: 'local'; readonly itemId: Id; readonly when: HIRPresence }
  | { readonly kind: 'child'; readonly referenceNodeId: Id; readonly when: HIRPresence }
  | { readonly kind: 'binding'; readonly bindingId: Id; readonly when: HIRPresence };
export interface HIREmissionPlan { readonly nodes: readonly HIREmission[]; readonly ports: readonly HIREmission[]; readonly edges: readonly HIREmission[]; }

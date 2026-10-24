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
export type AnalysisResult = { readonly kind: 'valid'; readonly program: ProgramModel; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'invalid'; readonly diagnostics: readonly Diagnostic[] };
export type AnalysisState =
  | { readonly kind: 'pending'; readonly revision: Revision; readonly previous?: ProgramModel }
  | { readonly kind: 'ready'; readonly revision: Revision; readonly program: ProgramModel; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'invalid'; readonly revision: Revision; readonly previous?: ProgramModel; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'failed'; readonly revision: Revision; readonly previous?: ProgramModel; readonly message: string };
export interface FlowUI {
  readonly state: AnalysisState;
  readonly selection: { readonly kind: 'definitions'; readonly scopeId: Id }
    | { readonly kind: 'function'; readonly functionId: Id };
}

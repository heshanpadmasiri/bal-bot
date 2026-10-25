import type { Id, Located, HIRNodeStyle, HIRPresentation, HIRGroupStyle, HIRPortRole, HIRAnchor, HIREdgeStyle, HIRRecursivePresentation } from '@bal-bot/workspace';
export type ExpansionPath = string;
export interface DiagramNode {
  readonly id: Id;
  readonly kind: HIRNodeStyle;
  readonly label: string;
  readonly selection: Located;
  readonly children: readonly DiagramNode[];
  readonly presentation: HIRPresentation;
  readonly layout: {
    readonly profile: HIRGroupStyle['profile']; readonly split?: number; readonly root: boolean;
    readonly visibility: HIRGroupStyle['root'];
    readonly reference?: { readonly path: string; readonly expanded: boolean; readonly recursive: boolean; readonly unavailable?: string; readonly recursivePresentation?: HIRRecursivePresentation };
  };
  readonly contextPath?: string;
  readonly contextExpanded?: boolean;
}
export interface DiagramPort { readonly id: Id; readonly nodeId: Id; readonly role: HIRPortRole; readonly anchor: HIRAnchor; }
export interface DiagramEdge { readonly fromPort: Id; readonly toPort: Id; readonly kind: HIREdgeStyle['kind']; readonly label?: string; readonly routing: HIREdgeStyle['routing']; }
export interface Diagram {
  readonly nodes: readonly DiagramNode[];
  readonly ports: readonly DiagramPort[];
  readonly edges: readonly DiagramEdge[];
  readonly interfaces: ReadonlyMap<Id, readonly Id[]>;
  readonly bindings: ReadonlyMap<Id, readonly DiagramEdge[]>;
}

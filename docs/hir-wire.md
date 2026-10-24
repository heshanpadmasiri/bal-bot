# HIR wire contract

The additive schema lives in `packages/workspace/src/flow.ts` and
`packages/compiler/hir.go`. It does not yet replace the legacy analysis bridge.
The types contain data only: no AST, compiler state, callbacks, or pixel geometry.

## Encoding

- Tags are the exact, case-sensitive `kind` strings in TypeScript. Go represents
  each structural union with a sealed variant interface inside a wrapper, for
  example `HIRPresence{Value: HIRConstantPresence{Value: true}}`.
- Concrete Go variants inject their own discriminator when marshaled. Union
  decoding selects a concrete pointer by discriminator, rejects unknown tags and
  unknown fields in that variant, and recursively decodes nested unions. Nil
  unions are errors. This is codec handling, not graph validation: required
  fields, enum values, ownership, and link invariants still need validators.
- Nullable HIR fields are required JSON keys with either a value or `null`:
  entry `owner`/`operation`, visible/recursive presentation `limitation`, and
  edge-style `label`. There are no `omitempty` fields in the new HIR schema.
  Retained discovery/source models keep their existing encoding unchanged.
- Empty collections are `[]` or `{}`, never `null`. Go `HIRList[T]` and
  `HIRRecord[T]` enforce this on encoding even for nil values, and reject null
  on decoding. The two records contain typed sources and graphs, respectively.
- Array order is meaningful. Future pretty printing sorts record keys only;
  it must not reorder nodes, ports, edges, groups, members, bindings, or emissions.

## Identity and ownership

`sources` is the complete ID-to-`Located` index, including source-bearing values
not currently displayed. A node's `sourceId` selects its original source identity;
its local `id` and `occurrenceKey` are separate render-instantiation identities.
Graph and scope locations must agree with the corresponding source entries.
Graph references use function IDs, never nested graph copies. Function-reference
cycles are valid; group-ownership cycles are not.

Every local node belongs to one group. `rootGroup` owns the top-level members;
a group-body node owns the direct members of its named group. Reference children
come from an instantiated target graph, not another local owning group.
All node, port, interface, binding, and edge IDs are local to their function graph;
reference interface IDs refer to the target graph's interface namespace.

## Presentation and layout

Visible presentations carry a complete selection/measurement label plus ordered
sections. Plain text uses `text` sections; client sections explicitly use
`receiver`, `context`, and `method`. Client-context disclosures carry both complete
label/section alternatives. Call disclosures carry availability and a fully
prepared recursive label/sections, limitation, title, ARIA label, and glyph.
Recursion is detected by graph ancestry, not syntax. It uses collapsed interfaces
and the declared recursive presentation, without mutating the stored graph.

Group `profile` tokens preserve the existing spacing vocabulary (`sequence`,
`if`, `while`, `foreach`, `trap`, plus explicit `root`/`call` profiles). They are
layout tokens, not instructions to inspect source syntax. Arrangement declares
actual member order/columns. Each profile has separate root/inline visibility
for the node, header, and container. An invisible root can therefore retain its
layout ownership while the inline emission plan omits the root node and ports.
Visibility never invents or connects ports. Anchors are symbolic attachments;
the renderer applies profile dimensions without language knowledge.

## Interfaces, bindings, and presence

Interface member ports are local. `exports` inserts the result of the named
export binding immediately before the zero-based **declared** member index
`beforeMember` (range `0..members.length`, inclusive at the end). Indexing precedes
presence filtering. Multiple exports at one index retain `exports` array order;
each binding retains target-member order. An export binding must name the same
caller interface that lists it, and is listed once. Collapsed interfaces use
caller-local ports and do not export inline bindings.

Binding directions are explicit: `entry` connects caller port to target-interface
members; `exit` connects target-interface members to caller port; `export` adds
target-interface members to the caller interface without an edge. Caller and
target IDs must never be discovered by rewriting strings. Root `terminal` leaves
members unconnected; root `connect` connects members to its local `toPort`, with
explicit edge metadata and a `bindingId` identifying the resulting edge batch.
That ID participates in the same graph-local binding namespace as inline bindings
and is emitted using a `binding` emission, allowing final root edges to remain
in their exact construction position. Root treatments are suppressed inline.

`nonempty` queries the effective interface of a direct reference node. Evaluate
presence bottom-up after child instantiation; use declared collapsed interfaces
for collapsed, unavailable, or recursion-stopped references. Boolean `all` over
an empty array is true and `any` over an empty array is false. Interface names
have no semantic meaning, and no static continuation flag replaces these rules.

## Ordered emission

Each graph declares separate root/inline plans for all three streams. A `local`
slot emits that stream's named local item; `child` splices an expanded reference's
inline stream; `binding` emits resulting edges only. Collapsed-reference edges
are graph-local edge items with explicit slots, active only in collapsed mode;
inline bindings and child splices are active only when that reference expands.
A false `when` suppresses a slot. Binding slots with no active results produce
no edges. Node plans preserve ownership preorder even when structural roots
are omitted. Port first-use order is declared, not reconstructed from edges.
Ports owned by omitted roots need no inline emission; mode-inactive edges and
bindings must not force their ports into the stream. Validators must check
coverage against active mode and presence, rather than blindly requiring every
stored item in every plan.

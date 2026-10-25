import type { HIRProgram, Id, SourceReference } from '@bal-bot/workspace';

export interface PlaygroundEntry {
  readonly id: Id;
  readonly label: string;
  readonly source: SourceReference;
}

// Use code point ordering rather than locale-dependent collation for stable menus.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function listEntries(program: HIRProgram): PlaygroundEntry[] {
  const entries = Object.values(program.functions)
    .sort((a, b) => compare(a.source.file, b.source.file)
      || a.source.range.start.line - b.source.range.start.line
      || a.source.range.start.column - b.source.range.start.column
      || compare(a.id, b.id))
    .map(graph => ({
      id: graph.id,
      label: `${graph.entry.owner ? `${graph.entry.owner} · ` : ''}${graph.entry.signature || graph.entry.name}`,
      source: graph.source,
    }));
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
  const located = entries.map(entry => counts.get(entry.label)! > 1
    ? { ...entry, label: `${entry.label} — ${entry.source.file}:${entry.source.range.start.line}:${entry.source.range.start.column}` }
    : entry);
  // Multiple graphs can share a location; IDs are the final disambiguator.
  const locatedCounts = new Map<string, number>();
  for (const entry of located) locatedCounts.set(entry.label, (locatedCounts.get(entry.label) ?? 0) + 1);
  return located.map(entry => locatedCounts.get(entry.label)! > 1
    ? { ...entry, label: `${entry.label} [${entry.id}]` }
    : entry);
}

export function resolveEntry(entries: readonly PlaygroundEntry[], preferred?: Id): PlaygroundEntry | undefined {
  return entries.find(entry => entry.id === preferred) ?? entries[0];
}

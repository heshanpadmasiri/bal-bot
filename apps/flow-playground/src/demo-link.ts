import type { Id } from '@bal-bot/workspace';

export interface Demo {
  readonly version: 1;
  readonly source: string;
  readonly functionId?: Id;
}

export type DecodedDemo =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly demo: Demo }
  | { readonly kind: 'invalid'; readonly message: string };

function isDemo(value: unknown): value is Demo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const demo = value as Record<string, unknown>;
  return demo.version === 1 && typeof demo.source === 'string'
    && (!Object.hasOwn(demo, 'functionId') || typeof demo.functionId === 'string');
}

/** Decode only a URL fragment; malformed links never become a default demo. */
export function decodeDemo(fragment: string): DecodedDemo {
  const encoded = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (encoded === '') return { kind: 'absent' };
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return { kind: 'invalid', message: 'Invalid demo link: the fragment must be percent-encoded JSON.' };
  }
  if (!isDemo(value)) {
    return { kind: 'invalid', message: 'Invalid demo link: expected version 1, a source string, and an optional functionId string.' };
  }
  // Copy only the supported fields, without normalizing the source in any way.
  const demo: Demo = value.functionId === undefined
    ? { version: 1, source: value.source }
    : { version: 1, source: value.source, functionId: value.functionId };
  return { kind: 'valid', demo };
}

/** Replace any existing fragment while retaining the URL's path and query. */
export function encodeDemo(baseUrl: string | URL, demo: Demo): string {
  if (!isDemo(demo)) throw new TypeError('Invalid version 1 demo.');
  const url = new URL(baseUrl);
  const payload = demo.functionId === undefined
    ? { version: 1, source: demo.source }
    : { version: 1, source: demo.source, functionId: demo.functionId };
  url.hash = encodeURIComponent(JSON.stringify(payload));
  return url.href;
}

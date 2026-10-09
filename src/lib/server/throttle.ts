import "server-only";

type Window = { start: number; count: number; ms: number };

/** Upper bound on tracked keys, so a flood of distinct addresses cannot grow the map without limit. */
const MAX_KEYS = 10_000;

// on globalThis, so the hot reloads of `next dev` share the counters
const cache = globalThis as typeof globalThis & { __elementsRateLimit?: Map<string, Window> };

function windows() {
  cache.__elementsRateLimit ??= new Map();
  return cache.__elementsRateLimit;
}

/**
 * Drops expired windows from the front of the map (it is ordered by window start), and the oldest live ones
 * while it is still over the limit.
 */
function evict(map: Map<string, Window>, now: number) {
  for (const [key, window] of map) {
    const expired = now - window.start >= window.ms;
    if (!expired && map.size <= MAX_KEYS) break;
    map.delete(key);
  }
}

/**
 * Counts one request against `key` (a bucket name plus the client address) and returns false once `max`
 * requests arrived within `ms`. Fixed windows, in memory and per process.
 */
export function withinLimit(key: string, max: number, ms: number): boolean {
  const now = Date.now();
  const map = windows();
  const current = map.get(key);
  if (current && now - current.start < current.ms) {
    if (current.count >= max) return false;
    current.count += 1;
    return true;
  }
  // re-inserted rather than updated, so the map stays ordered by window start
  map.delete(key);
  map.set(key, { start: now, count: 1, ms });
  if (map.size > MAX_KEYS) evict(map, now);
  return true;
}

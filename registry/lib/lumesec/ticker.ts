/**
 * LumeSec Elements: one shared animation frame for every animated component on the page.
 *
 * Each component used to run its own requestAnimationFrame loop, and a loop that drew
 * at a lower rate still woke on every display frame. Callbacks queued here run together in a single frame callback.
 * The frame is requested only while something is queued, so an idle page requests no frames at all, and a callback
 * that waits for a later time sleeps on one shared timer instead of waking every frame. Browsers hold animation
 * frames in hidden tabs, so queued work waits there.
 */

type TickCallback = (now: number) => void;

let pending = new Map<number, TickCallback>();
let running = new Map<number, TickCallback>();
/** Callbacks that wait for a later time, with that time from `performance.now()`. */
const waiting = new Map<number, { callback: TickCallback; at: number }>();
let nextId = 1;
let frame = 0;
let timer = 0;
let timerAt = Number.POSITIVE_INFINITY;

/**
 * A callback due within this many milliseconds goes to the next frame; a later one waits on the timer, which fires
 * this much early so the frame after it is the first one at or past the due time.
 */
const FRAME_SLACK = 2;

function flush(now: number): void {
  frame = 0;
  // swap the queues: callbacks queued while this frame runs go to the next frame
  const due = pending;
  pending = running;
  running = due;
  for (const callback of due.values()) callback(now);
  due.clear();
}

function requestFrame(): void {
  if (!frame && pending.size) frame = requestAnimationFrame(flush);
}

/** Set the shared timer for the earliest waiting callback. */
function scheduleWaiting(): void {
  let at = Number.POSITIVE_INFINITY;
  for (const entry of waiting.values()) at = Math.min(at, entry.at);
  if (at === timerAt) return;
  window.clearTimeout(timer);
  timerAt = at;
  timer = 0;
  if (at < Number.POSITIVE_INFINITY) {
    timer = window.setTimeout(releaseWaiting, Math.max(0, at - performance.now() - FRAME_SLACK));
  }
}

function releaseWaiting(): void {
  timer = 0;
  timerAt = Number.POSITIVE_INFINITY;
  const now = performance.now();
  for (const [id, entry] of waiting) {
    if (entry.at - now > FRAME_SLACK) continue;
    waiting.delete(id);
    pending.set(id, entry.callback);
  }
  requestFrame();
  scheduleWaiting();
}

/**
 * Run `callback` on the next shared animation frame, or on the first frame at or after `notBefore` (a
 * `performance.now()` time). Returns an id for {@link cancelTick}; never 0.
 */
export function requestTick(callback: TickCallback, notBefore = 0): number {
  const id = nextId++;
  if (notBefore - performance.now() > FRAME_SLACK) {
    waiting.set(id, { callback, at: notBefore });
    scheduleWaiting();
    return id;
  }
  pending.set(id, callback);
  requestFrame();
  return id;
}

/** Drop a callback queued with {@link requestTick}. Unknown ids and 0 are ignored. */
export function cancelTick(id: number): void {
  if (!id) return;
  if (waiting.delete(id)) {
    scheduleWaiting();
    return;
  }
  // a callback cancelled while its frame runs is skipped too: deleting during iteration is safe for a Map
  running.delete(id);
  if (pending.delete(id) && pending.size === 0 && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}

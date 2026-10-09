"use client";

import * as React from "react";

import { fillSquare, localPoint, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette, type Palette } from "@/lib/lumesec/color";
import {
  angleDelta,
  createDotBatch,
  createProjection,
  createScreenPoint,
  cubicBezier,
  easeInCubic,
  easeOutBack,
  flatPaths,
  forEachDot,
  GEO_TOKENS,
  geoInk,
  mapLattice,
  nearestIndex,
  projectionAspect,
  projectionOutlineSvgPath,
  ringFront,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoInk,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { formatAgo, formatZonedTime, toEpochMs, useNow } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, mixRgb, rgba, smoothstep } from "@/lib/lumesec/math";
import { prefersReducedMotion, settleSpring, useAnimationLoop, useLazyRef, type Spring } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks, type SparkOptions } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Kind of device a session runs on. It picks the row's icon. */
export type SessionDevice = "laptop" | "desktop" | "phone" | "tablet" | "terminal";

/** One place where the account is signed in. */
export interface Session {
  /** Unique id. `onRevoke` reports it. */
  readonly id: string;
  /** Device type, for the row's icon. */
  readonly device: SessionDevice;
  /** What the session is, such as `Work laptop` or `Browser on phone`. */
  readonly label: string;
  /** Where the session was last seen, as the row shows it. */
  readonly city: string;
  /** Latitude in degrees. A session without coordinates has no point on the map. */
  readonly lat?: number;
  /** Longitude in degrees. */
  readonly lon?: number;
  /** Last activity: epoch ms, an ISO date-time (read as UTC without an offset) or a Date. */
  readonly lastActive: number | string | Date;
  /** The session of this device: the accent point, the "This device" chip and no Sign out button. */
  readonly current?: boolean;
  /** The location is a rough estimate, for example from the network address. The point gets a dotted ring. */
  readonly approximate?: boolean;
}

/** Props of `GeoSessions`. Other `div` props, `ref` included, go to the root. */
export interface GeoSessionsProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** Sessions (controlled). Use with `onSessionsChange`. An empty array shows "No active sessions". */
  sessions?: readonly Session[];
  /** Sessions when uncontrolled. Without `sessions` and `defaultSessions` the component shows six demo sessions. */
  defaultSessions?: readonly Session[];
  /** Called with the remaining sessions after a sign-out, once the rows have collapsed. */
  onSessionsChange?: (sessions: readonly Session[]) => void;
  /** Called with the ids that were signed out. Not called for the built-in demo sessions. */
  onRevoke?: (ids: readonly string[]) => void;
  /** Requires a second click within 4 seconds to sign out all other sessions. */
  confirm?: boolean;
  /** Reference time in epoch ms for the relative times. Without it a clock starts after mount. */
  now?: number;
  /** BCP 47 locale of the relative times and dates. Default `en-US`. */
  locale?: string;
  /** Header text. */
  title?: React.ReactNode;
}

/**
 * The places an account is signed in, as a list with a compact dot map above it. Each row shows the device, the
 * city and when it was last active; pointing at a row (or focusing its button) pulses its point and draws a dotted
 * line to it from this device.
 *
 * Sign out other sessions sends a wave across the map from this device. As the front reaches each session, its point
 * breaks into dots that collapse inward and burst into sparks, and its row collapses on the same frame, nearest
 * first. A single Sign out plays the same ending for one row without the wave.
 *
 * @example
 * <GeoSessions sessions={sessions} onSessionsChange={setSessions} onRevoke={(ids) => revokeSessions(ids)} />
 */
export function GeoSessions({
  sessions,
  defaultSessions,
  onSessionsChange,
  onRevoke,
  confirm = true,
  now,
  locale,
  title = "Active sessions",
  ref,
  className,
  onKeyDown,
  ...props
}: GeoSessionsProps) {
  const demo = sessions === undefined && defaultSessions === undefined;
  const [list, setList] = useControllableState<readonly Session[]>({
    value: sessions,
    defaultValue: defaultSessions ?? DEMO_SESSIONS,
    onChange: onSessionsChange,
  });
  const hintId = React.useId();

  /** Rows collapsing right now: still in the list, but inert and hidden from assistive technology. */
  const [leaving, setLeaving] = React.useState<ReadonlySet<string>>(NO_IDS);
  /** Ids signed out while `list` was this array. A controlled parent that has not updated yet keeps them hidden. */
  const [revoked, setRevoked] = React.useState<Revoked | null>(null);
  const [armedAt, setArmedAt] = React.useState<number | null>(null);
  const [sweeping, setSweeping] = React.useState(false);
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [mapHoverId, setMapHoverId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState({ key: 0, text: "" });

  const pendingIds = revoked !== null && revoked.list === list ? revoked.ids : NO_IDS;
  const visible = React.useMemo(
    () => (pendingIds.size ? list.filter((session) => !pendingIds.has(session.id)) : list),
    [list, pendingIds],
  );
  const others = visible.filter((session) => !session.current && !leaving.has(session.id));
  const armed = armedAt !== null && others.length > 0 && !sweeping;
  const previewId = sweeping ? null : (hoverId ?? focusId ?? mapHoverId);

  // Relative times: the `now` prop, else a clock that starts after mount. Until then the server markup shows
  // absolute dates in UTC; the demo sessions are written relative to DEMO_NOW and move to the clock unchanged.
  const tick = useNow(CLOCK_MS, now === undefined);
  const reference = now ?? tick;
  const [anchor, setAnchor] = React.useState<number | null>(reference);
  if (anchor === null && reference !== null) setAnchor(reference);
  const clock: TimeContext = { demo, reference, anchor, locale };

  const footerLabel = sweeping
    ? FOOTER.sweeping
    : others.length === 0
      ? FOOTER.none
      : armed
        ? FOOTER.armed
        : FOOTER.idle;
  const [footer, setFooter] = React.useState({ label: footerLabel, direction: 1 });
  if (footer.label !== footerLabel) {
    setFooter({
      label: footerLabel,
      direction: FOOTER_ORDER.indexOf(footerLabel) >= FOOTER_ORDER.indexOf(footer.label) ? 1 : -1,
    });
  }

  const rootRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const marksRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const footerRef = React.useRef<HTMLButtonElement>(null);
  const engineRef = useLazyRef(() => new SessionsMap());
  const rowNodes = React.useRef(new Map<string, HTMLLIElement>());
  const rowAnimations = React.useRef(new Map<string, Animation>());
  const timers = React.useRef(new Set<number>());
  const sweepIds = React.useRef<readonly string[]>([]);
  /** Counts sweeps, so a safety timer only ends the sweep that started it. */
  const sweepCount = React.useRef(0);
  /** The latest list and callbacks, for timers and the frame loop. */
  const latest = React.useRef({ list, demo, onRevoke });

  React.useImperativeHandle(ref, () => rootRef.current!, []);

  /** Where the map sits on the effects layer, in CSS px (offsets ignore the gallery's zoom). */
  function measureEffects() {
    const map = mapRef.current;
    const layer = effectsRef.current;
    if (map && layer)
      engineRef.current.setEffectsOffset(map.offsetLeft - layer.offsetLeft, map.offsetTop - layer.offsetTop);
  }

  const loop = useAnimationLoop(rootRef, step);
  const palette = usePalette(rootRef, GEO_TOKENS, applyTheme);
  const base = useCanvas(
    baseRef,
    (surface) => {
      engineRef.current.layout(surface.width, surface.height, surface.dpr);
      measureEffects();
      loop.kick();
    },
    MAP_CANVAS,
  );
  const marks = useCanvas(
    marksRef,
    () => {
      engineRef.current.invalidate();
      loop.kick();
    },
    MAP_CANVAS,
  );
  const effects = useCanvas(
    effectsRef,
    () => {
      measureEffects();
      loop.kick();
    },
    MAP_CANVAS,
  );

  function step(_time: number, delta: number) {
    return engineRef.current.step(base.current, marks.current, effects.current, delta);
  }

  function applyTheme() {
    const colors = palette.current;
    if (!colors) return;
    engineRef.current.setInk(geoInk(colors));
    loop.kick();
  }

  React.useEffect(() => {
    latest.current = { list, demo, onRevoke };
  });

  // The engine reports hits from the frame loop; the handlers change only refs, the DOM and state setters.
  React.useEffect(() => {
    const engine = engineRef.current;
    engine.onHit = (ids) => {
      collapseRows(ids);
      setLeaving((current) => withIds(current, ids));
    };
    engine.onSwept = () => {
      schedule(() => {
        setSweeping(false);
        finalize(sweepIds.current);
        sweepIds.current = [];
      }, COLLAPSE_MS);
    };
  });

  React.useEffect(() => {
    engineRef.current.setSessions(visible, leaving);
    loop.kick();
  }, [visible, leaving, engineRef, loop]);

  React.useEffect(() => {
    engineRef.current.setPreview(previewId);
    loop.kick();
  }, [previewId, engineRef, loop]);

  // A row that is back after its collapse (a controlled parent kept it) shows again.
  React.useEffect(() => {
    for (const [id, animation] of rowAnimations.current) {
      if (leaving.has(id)) continue;
      animation.cancel();
      rowAnimations.current.delete(id);
    }
  }, [leaving, visible]);

  // The armed footer button disarms itself after 4 seconds.
  React.useEffect(() => {
    if (armedAt === null) return;
    const timer = window.setTimeout(() => setArmedAt(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [armedAt]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  function schedule(callback: () => void, ms: number) {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, ms);
    timers.current.add(timer);
  }

  /** Height to 0 and opacity to 0 over 260 ms, started on the frame the wave reaches the session. */
  function collapseRows(ids: readonly string[]) {
    if (prefersReducedMotion()) return;
    for (const id of ids) {
      const row = rowNodes.current.get(id);
      if (!row || typeof row.animate !== "function") continue;
      rowAnimations.current.get(id)?.cancel();
      const animation = row.animate(
        [
          { height: `${row.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        {
          duration: COLLAPSE_MS,
          easing: COLLAPSE_EASING,
          fill: "forwards",
        },
      );
      rowAnimations.current.set(id, animation);
    }
  }

  /** The rows have collapsed: the sessions leave the list, the callbacks fire and the count rolls down. */
  function finalize(ids: readonly string[]) {
    if (ids.length === 0) return;
    const done = new Set(ids);
    const { list: current, demo: isDemo, onRevoke: revoke } = latest.current;
    engineRef.current.forget(ids);
    setRevoked((previous) => ({
      list: current,
      ids: previous && previous.list === current ? withIds(previous.ids, ids) : done,
    }));
    setLeaving((previous) => withoutIds(previous, ids));
    // a row that collapsed under the pointer or with focus fires no leave or blur: drop its preview
    const keep = (id: string | null) => (id !== null && done.has(id) ? null : id);
    setHoverId(keep);
    setFocusId(keep);
    setMapHoverId(keep);
    setList((previous) => previous.filter((session) => !done.has(session.id)));
    if (!isDemo) revoke?.(ids);
    setAnnouncement((previous) => ({
      key: previous.key + 1,
      text: `${ids.length} ${ids.length === 1 ? "session" : "sessions"} signed out`,
    }));
  }

  function signOutOthers() {
    const ids = others.map((session) => session.id);
    if (ids.length === 0) return;
    setArmedAt(null);
    if (prefersReducedMotion()) {
      setLeaving((current) => withIds(current, ids));
      finalize(ids);
      return;
    }
    setSweeping(true);
    sweepIds.current = ids;
    const sweep = ++sweepCount.current;
    engineRef.current.sweep(ids);
    loop.kick();
    // the wave needs the frame loop; if it cannot run (a hidden tab), finish without it, unless a later sweep runs
    schedule(() => {
      if (sweepCount.current === sweep) engineRef.current.finishSweep();
    }, SWEEP_SAFETY_MS);
  }

  function handleFooterClick() {
    if (sweeping || others.length === 0) return;
    if (confirm && !armed) {
      setArmedAt(performance.now());
      return;
    }
    signOutOthers();
  }

  function signOut(id: string, button: HTMLButtonElement) {
    if (sweeping || leaving.has(id)) return;
    // focus moves before the row turns inert: to the next row's button, or to the footer
    const buttons = signOutButtons();
    const next = buttons[buttons.indexOf(button) + 1] ?? footerRef.current;
    next?.focus({ preventScroll: true });
    setLeaving((current) => withIds(current, [id]));
    if (prefersReducedMotion()) {
      finalize([id]);
      return;
    }
    engineRef.current.implode(id);
    collapseRows([id]);
    loop.kick();
    schedule(() => finalize([id]), COLLAPSE_MS);
  }

  function signOutButtons() {
    const listElement = listRef.current;
    return listElement
      ? Array.from(listElement.querySelectorAll<HTMLButtonElement>("li:not([inert]) button[data-sign-out]"))
      : [];
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const buttons = signOutButtons();
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const target =
      event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, index + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    buttons[target].focus();
  }

  function handleMapPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    // in CSS px of the map, which the gallery may show zoomed
    const { x, y } = localPoint(event.currentTarget, event.clientX, event.clientY);
    setMapHoverId(engineRef.current.nearest(x, y, MAP_HOVER_RADIUS));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.key === "Escape" && armed) {
      event.preventDefault();
      setArmedAt(null);
    }
  }

  const registerRow = React.useCallback((id: string, node: HTMLLIElement | null) => {
    if (node) rowNodes.current.set(id, node);
    else rowNodes.current.delete(id);
  }, []);

  const count = visible.length;

  return (
    <div
      ref={rootRef}
      data-slot="geo-sessions"
      className={cn(
        "relative w-full max-w-[400px] rounded-[14px] border border-border bg-card text-card-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)] [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      <div aria-hidden="true" className="relative">
        <div className="border-b border-border px-3 pt-3 pb-2.5">
          <div
            ref={mapRef}
            className="relative w-full select-none"
            style={{ aspectRatio: MAP_ASPECT }}
            onPointerMove={handleMapPointer}
            onPointerLeave={() => setMapHoverId(null)}
          >
            <svg
              viewBox={`0 0 ${NOMINAL_WIDTH} ${NOMINAL_HEIGHT}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 block size-full overflow-visible"
            >
              <path
                d={MAP_OUTLINE}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1}
                className="fill-muted/40 stroke-border"
              />
            </svg>
            <canvas ref={baseRef} className="absolute inset-0 block size-full" />
            <canvas
              ref={marksRef}
              className="pointer-events-none absolute block"
              style={{
                inset: -MARK_PAD,
                width: `calc(100% + ${MARK_PAD * 2}px)`,
                height: `calc(100% + ${MARK_PAD * 2}px)`,
              }}
            />
          </div>
        </div>
        <canvas
          ref={effectsRef}
          className="pointer-events-none absolute -top-10 -left-4 z-[3] block h-[calc(100%+80px)] w-[calc(100%+32px)] min-[480px]:-left-10 min-[480px]:w-[calc(100%+80px)]"
        />
      </div>

      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-1.5">
        <div className="min-w-0 truncate text-[14px] leading-5 font-medium tracking-[-0.005em] text-foreground">
          {title}
        </div>
        <div className="shrink-0 text-[12.5px] leading-5 text-muted-foreground">
          Signed in on{" "}
          <span className="font-mono text-[12.5px] text-foreground tabular-nums">
            <Count value={count} />
          </span>{" "}
          {count === 1 ? "device" : "devices"}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="m-0 grid h-[52px] place-items-center px-4 pb-1.5 text-[12.5px] leading-5 text-muted-foreground">
          No active sessions
        </p>
      ) : (
        <ul
          ref={listRef}
          aria-label="Sessions"
          className="m-0 grid list-none p-0 px-1.5 pb-1.5"
          onKeyDown={handleListKeyDown}
        >
          {visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              time={sessionTime(session, clock)}
              active={session.id === previewId}
              leaving={leaving.has(session.id)}
              busy={sweeping}
              register={registerRow}
              onHover={setHoverId}
              onFocusPreview={setFocusId}
              onSignOut={signOut}
            />
          ))}
        </ul>
      )}

      <div className="border-t border-border p-3">
        <button
          ref={footerRef}
          type="button"
          data-state={armed ? "armed" : sweeping ? "busy" : "idle"}
          aria-disabled={sweeping || others.length === 0 || undefined}
          aria-describedby={armed ? hintId : undefined}
          onClick={handleFooterClick}
          className="relative flex h-9 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-3 font-[inherit] text-[13px] leading-5 font-medium text-foreground transition-[background-color,border-color,color] duration-200 outline-none hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:bg-card data-[state=armed]:border-[color-mix(in_srgb,var(--destructive)_55%,var(--border))] data-[state=armed]:bg-destructive/6 data-[state=armed]:text-destructive data-[state=armed]:hover:bg-destructive/10 motion-reduce:transition-none"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-3.5 shrink-0"
          >
            <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
            <path d="M10.5 5 13.5 8l-3 3M13.5 8h-7" />
          </svg>
          <RollText
            text={footer.label}
            direction={footer.direction}
            reserve={FOOTER_ORDER}
            className="justify-items-center"
          />
          <Fuse armedAt={armed ? armedAt : null} />
        </button>
        <span id={hintId} hidden>
          Press again within 4 seconds to confirm
        </span>
      </div>

      <div aria-live="polite" className="sr-only">
        <span key={announcement.key}>{announcement.text}</span>
      </div>
    </div>
  );
}

/* Rows ------------------------------------------------------------------------------------------------ */

interface SessionRowProps {
  session: Session;
  time: string;
  /** Previewed on the map: hovered, focused, or its point is under the pointer. */
  active: boolean;
  leaving: boolean;
  /** The wave is running: the Sign out buttons wait. */
  busy: boolean;
  register: (id: string, node: HTMLLIElement | null) => void;
  onHover: (id: string | null) => void;
  onFocusPreview: (id: string | null) => void;
  onSignOut: (id: string, button: HTMLButtonElement) => void;
}

/** One session: the device tile, the label and the city, the relative time and the Sign out button or the chip. */
function SessionRow({
  session,
  time,
  active,
  leaving,
  busy,
  register,
  onHover,
  onFocusPreview,
  onSignOut,
}: SessionRowProps) {
  const { id, current = false, approximate = false } = session;
  return (
    <li
      ref={(node) => register(id, node)}
      inert={leaving}
      aria-hidden={leaving || undefined}
      data-active={active ? "" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHover(id);
      }}
      onPointerLeave={() => onHover(null)}
      className="group/row overflow-hidden"
    >
      <div className="flex h-[52px] items-center gap-3 rounded-[10px] px-2.5 transition-colors duration-150 group-data-[active]/row:bg-muted/60 motion-reduce:transition-none">
        <DeviceTile device={session.device} current={current} />
        <div className="grid min-w-0 flex-1 gap-[3px]">
          <span className="truncate text-[13px] leading-4 font-medium text-foreground">{session.label}</span>
          <span className="truncate text-[12px] leading-4 text-muted-foreground">
            {session.city}
            {approximate ? <span className="text-muted-foreground/80"> · approximate</span> : null}
          </span>
        </div>
        <span className="shrink-0 text-right text-[12px] leading-4 text-muted-foreground tabular-nums">
          <RollText text={time} className="justify-items-end" />
        </span>
        {current ? (
          <span className="grid h-[22px] w-[76px] shrink-0 place-items-center rounded-md border border-lumesec/30 bg-lumesec/8 text-[11.5px] leading-4 font-medium text-lumesec">
            This device
          </span>
        ) : (
          <button
            type="button"
            data-sign-out=""
            disabled={busy}
            aria-label={`Sign out ${session.label}, ${session.city}`}
            onClick={(event) => onSignOut(id, event.currentTarget)}
            onFocus={(event) => {
              // keyboard focus previews; focus that follows a click does not
              if (event.currentTarget.matches(":focus-visible")) onFocusPreview(id);
            }}
            onBlur={() => onFocusPreview(null)}
            className="h-7 w-[76px] shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-2 font-[inherit] text-[12.5px] leading-4 font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-destructive/8 hover:text-destructive focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-lumesec focus-visible:outline-solid disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground motion-reduce:transition-none"
          >
            Sign out
          </button>
        )}
      </div>
    </li>
  );
}

/** The 28 px device tile: a line icon on a quiet square, in the accent for this device. */
function DeviceTile({ device, current }: { device: SessionDevice; current: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[7px] border border-border bg-muted/40 text-muted-foreground transition-colors duration-150 group-data-[active]/row:border-[color-mix(in_srgb,var(--foreground)_22%,var(--border))] group-data-[active]/row:text-foreground motion-reduce:transition-none",
        current &&
          "border-lumesec/35 bg-lumesec/8 text-lumesec group-data-[active]/row:border-lumesec/50 group-data-[active]/row:text-lumesec",
      )}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        {DEVICE_ICONS[device] ?? DEVICE_ICONS.laptop}
      </svg>
    </span>
  );
}

const DEVICE_ICONS: Record<SessionDevice, React.ReactNode> = {
  laptop: (
    <>
      <rect x="3" y="3.5" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" />
    </>
  ),
  desktop: (
    <>
      <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1" />
      <path d="M8 11v2.5M5.5 13.5h5" />
    </>
  ),
  phone: (
    <>
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.6" />
      <path d="M7.25 12.25h1.5" />
    </>
  ),
  tablet: (
    <>
      <rect x="2.5" y="1.75" width="11" height="12.5" rx="1.6" />
      <path d="M7.25 12h1.5" />
    </>
  ),
  terminal: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" />
      <path d="m4.5 6 2 2-2 2M8.5 10.25h3" />
    </>
  ),
};

/** The header count as mechanical figures: it rolls in the direction of the change. */
function Count({ value }: { value: number }) {
  const [shown, setShown] = React.useState({ value, direction: 1 });
  if (shown.value !== value) setShown({ value, direction: value >= shown.value ? 1 : -1 });
  return <RollText text={String(value)} direction={shown.direction} />;
}

/* Fuse ------------------------------------------------------------------------------------------------ */

const FUSE_TOKENS = {
  destructive: GEO_TOKENS.destructive,
  foreground: GEO_TOKENS.foreground,
} as const;

/**
 * The confirm timer along the bottom edge of the armed button: a row of dots that burns down from the right over
 * 4 seconds, with an uneven, flickering tip. With reduced motion it still burns down, without the flicker.
 */
function Fuse({ armedAt }: { armedAt: number | null }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const armedRef = React.useRef(armedAt);
  const cleared = React.useRef(true);
  const loop = useAnimationLoop(canvasRef, step);
  const palette = usePalette(canvasRef, FUSE_TOKENS, () => loop.kick());
  const surface = useCanvas(canvasRef, () => loop.kick());

  React.useEffect(() => {
    armedRef.current = armedAt;
    loop.kick();
  }, [armedAt, loop]);

  function step(time: number) {
    const target = surface.current;
    const colors = palette.current;
    if (!target || !colors) return false;
    const start = armedRef.current;
    if (start === null) {
      if (!cleared.current) clearSurface(target);
      cleared.current = true;
      return false;
    }
    cleared.current = false;
    const remaining = 1 - clamp((performance.now() - start) / CONFIRM_MS, 0, 1);
    drawFuse(target, colors, remaining, time);
    return remaining > 0;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 block h-2 w-full"
    />
  );
}

function clearSurface({ context, width, height }: CanvasSurface) {
  context.clearRect(0, 0, width, height);
}

/** Draws the fuse with `remaining` (1 to 0) of its dots left; `time` in seconds drives the flicker. */
function drawFuse(surface: CanvasSurface, colors: Palette<keyof typeof FUSE_TOKENS>, remaining: number, time: number) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  const reduced = prefersReducedMotion();
  const tip = mixRgb(colors.destructive, colors.foreground, colors.dark ? 0.55 : 0.25);
  const span = Math.max(1, width - FUSE_INSET * 2);
  const count = Math.floor(span / FUSE_PITCH) + 1;
  const y = height - FUSE_BOTTOM;
  for (let i = 0; i < count; i++) {
    const n = count > 1 ? i / (count - 1) : 0;
    const seed = i * 31 + 7;
    // an uneven tip, the same jitter rule as the map fronts
    const threshold = n * 0.94 + seededUnit(seed + 1.13) * 0.06;
    const lit = remaining - threshold;
    if (lit < -FUSE_EMBER) continue;
    let alpha: number;
    let size = DOT;
    let color = colors.destructive;
    if (lit >= 0) {
      const glow = Math.exp(-lit / 0.025);
      const flicker = reduced
        ? 1
        : 0.7 + 0.3 * Math.sin(time * (9 + seededUnit(seed + 0.71) * 14) + seededUnit(seed + 0.37) * 6.28);
      alpha = 0.5 + 0.5 * glow * flicker;
      size = DOT + 0.75 * glow;
      if (glow > 0.3) color = mixRgb(colors.destructive, tip, glow);
    } else {
      // burnt dots right behind the tip fade out
      alpha = 0.45 * (1 + lit / FUSE_EMBER);
    }
    context.globalAlpha = alpha;
    context.fillStyle = rgba(color);
    fillSquare(context, FUSE_INSET + n * span, y, size, dpr);
  }
  context.globalAlpha = 1;
}

/* Time ------------------------------------------------------------------------------------------------ */

interface TimeContext {
  demo: boolean;
  /** `now`, or the clock once it runs; null before mount. */
  reference: number | null;
  /** The first reference seen: demo times shift by anchor − DEMO_NOW. */
  anchor: number | null;
  locale: string | undefined;
}

/** "5 minutes ago" once a reference time exists; before that an absolute date in UTC, the same on server and client. */
function sessionTime(session: Session, { demo, reference, anchor, locale }: TimeContext) {
  const time = toEpochMs(session.lastActive);
  if (time === null) return "–";
  if (demo) return formatAgo(time - DEMO_NOW + (anchor ?? DEMO_NOW), reference ?? DEMO_NOW, locale);
  if (reference === null) return `${formatZonedTime("UTC", time, { date: "short", locale })} UTC`;
  return formatAgo(time, reference, locale);
}

/* Constants ------------------------------------------------------------------------------------------- */

interface Revoked {
  readonly list: readonly Session[];
  readonly ids: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set();

function withIds(set: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (ids.every((id) => set.has(id))) return set;
  const next = new Set(set);
  for (const id of ids) next.add(id);
  return next;
}

function withoutIds(set: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (!ids.some((id) => set.has(id))) return set;
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next.size ? next : NO_IDS;
}

const FOOTER = {
  idle: "Sign out other sessions",
  armed: "Confirm sign-out",
  sweeping: "Signing out",
  none: "No other sessions",
} as const;
/** Footer labels in the order they follow each other; the label rolls forward along it and back against it. */
const FOOTER_ORDER: readonly string[] = [FOOTER.idle, FOOTER.armed, FOOTER.sweeping, FOOTER.none];

const CLOCK_MS = 30_000;
const CONFIRM_MS = 4000;
const COLLAPSE_MS = 260;
const COLLAPSE_EASING = "cubic-bezier(.4,0,.2,1)";
/** A sweep that cannot animate (no frames) finishes after this long. */
const SWEEP_SAFETY_MS = 3000;

const LAT_RANGE: readonly [number, number] = [-50, 72];
const MAP_ASPECT = projectionAspect("equalEarth", LAT_RANGE);
const NOMINAL_WIDTH = 1000;
const NOMINAL_HEIGHT = Math.round((NOMINAL_WIDTH / MAP_ASPECT) * 100) / 100;
const MAP_OUTLINE = projectionOutlineSvgPath(
  createProjection("equalEarth", { width: NOMINAL_WIDTH, height: NOMINAL_HEIGHT, latRange: LAT_RANGE }),
);
const MAP_CANVAS = { maxDpr: 2 } as const;
/** The marks canvas reaches this far past the map, so rings at the edge are not cut. */
const MARK_PAD = 8;
const MAP_HOVER_RADIUS = 10;

/** Lattice pitch and dot size in CSS px. */
const PITCH = 3.5;
const DOT = 1.5;
const POINT = 5;
const CURRENT_POINT = 6;
/** The current point's ring: a 1 px square ring with a 1 px gap. */
const CURRENT_RING = 10;
/** Approximate sessions: 12 dots on a 12 px ring. */
const APPROX_RADIUS = 6;
const APPROX_DOTS = 12;
/** The preview highlight's spring: a quick, slightly under-damped snap that settles within 0.002 of its target. */
const HIGHLIGHT_SPRING = { stiffness: 420, damping: 0.8, epsilon: 0.002, velocityEpsilon: 0.01 };

const REVEAL_MS = 1100;
const REVEAL_BAND = 0.06;
const REVEAL_END = 1 + REVEAL_BAND * 1.5;

/** The preview pulse: two lattice rings, 0.8 s in all. */
const PULSE_MS = 800;
const PULSE_RING_S = 0.56;
const PULSE_GAP_S = 0.2;
const PULSE_RADIUS = 20;
/** The preview line: drawn on over 300 ms, faded over 200 ms. */
const ARC_MS = 300;
const ARC_FADE_MS = 200;
const ARC_BEND = 0.2;
const ARC_SPACING = 3.5;
const ARC_EASE = cubicBezier(0.45, 0, 0.25, 1);

/** The sweep: r(t) = 420·t px from this device, a ringFront(d, r, 9, jitter, 6) front and a decaying tail. */
const WAVE_SPEED = 420;
const WAVE_WIDTH = 9;
const WAVE_UNEVEN = 6;
const WAVE_TAIL = 44;
const WAVE_TAIL_LEVEL = 0.5;
/** This device flares for a moment before the front leaves it. */
const WAVE_CHARGE_MS = 90;
const ORIGIN_FLASH_MS = 460;
/** Sea dots only show while lit, at this share of the land's brightness. */
const SEA_ALPHA = 0.42;

/** The implode: the dots of a 5 px disc contract to the centre in 120 ms, then 10 sparks and a short flash. */
const IMPLODE_MS = 120;
const IMPLODE_RADIUS = 5;
const IMPLODE_DOTS = 13;
const FLASH_MS = 160;
const GOLDEN_ANGLE = 2.399963;
const IMPLODE_SPARKS: SparkOptions = { speed: [50, 180], life: [0.3, 0.75], size: [1.5, 2], jitter: 1 };

const FUSE_PITCH = 3.5;
const FUSE_INSET = 10;
const FUSE_BOTTOM = 3;
/** Burnt dots behind the tip fade over this share of the fuse. */
const FUSE_EMBER = 0.035;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The demo sessions are written relative to this instant; after mount their times move with the real clock. */
const DEMO_NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

/** Six invented sessions: this laptop in London and five others, nearest to farthest from it. */
const DEMO_SESSIONS: readonly Session[] = [
  {
    id: "demo-laptop",
    device: "laptop",
    label: "Work laptop",
    city: "London",
    lat: 51.5072,
    lon: -0.1276,
    lastActive: DEMO_NOW,
    current: true,
  },
  {
    id: "demo-phone",
    device: "phone",
    label: "Phone",
    city: "London",
    lat: 51.5072,
    lon: -0.1276,
    lastActive: DEMO_NOW - 4 * MINUTE,
  },
  {
    id: "demo-desktop",
    device: "desktop",
    label: "Office desktop",
    city: "Berlin",
    lat: 52.52,
    lon: 13.405,
    lastActive: DEMO_NOW - 2 * HOUR,
  },
  {
    id: "demo-tablet",
    device: "tablet",
    label: "Tablet",
    city: "New York",
    lat: 40.7128,
    lon: -74.006,
    lastActive: DEMO_NOW - 27 * HOUR,
  },
  {
    id: "demo-terminal",
    device: "terminal",
    label: "Command line",
    city: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
    lastActive: DEMO_NOW - 3 * DAY,
  },
  {
    id: "demo-lisbon",
    device: "laptop",
    label: "Laptop",
    city: "Lisbon",
    lat: 38.7223,
    lon: -9.1393,
    lastActive: DEMO_NOW - 9 * DAY,
    approximate: true,
  },
];

/** Deterministic 0..1 per seed (the effort-slider hash), for the fuse's jitter and flicker. */
function seededUnit(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* Map engine ------------------------------------------------------------------------------------------ */

interface MapPoint {
  readonly id: string;
  /** Latitude clamped to the map's crop. */
  readonly lat: number;
  readonly lon: number;
  readonly current: boolean;
  readonly approximate: boolean;
  /** Position on the map in CSS px, updated on resize. */
  x: number;
  y: number;
  /** Imploded or collapsing: not drawn. */
  gone: boolean;
  /** Preview highlight, 0 to 1, on a spring. */
  readonly highlight: Spring;
}

interface Arc {
  readonly id: string;
  readonly tables: ArcLengthTable[];
  readonly start: number;
  /** When the fade started, or −1 while shown. */
  fade: number;
}

interface Pulse {
  readonly x: number;
  readonly y: number;
  readonly start: number;
}

interface Implosion {
  readonly x: number;
  readonly y: number;
  readonly start: number;
  burst: boolean;
}

interface WaveTarget {
  readonly ids: string[];
  readonly distance: number;
}

interface Wave {
  readonly start: number;
  readonly x: number;
  readonly y: number;
  /** Distance to the farthest corner of the map. */
  readonly reach: number;
  /** Distance of every lattice dot from the origin. */
  readonly distances: Float32Array;
  /** Sessions with a point, nearest first; sessions at the same place share a target. */
  readonly targets: WaveTarget[];
  /** Sessions without coordinates: they go when the front has crossed the map. */
  readonly late: string[];
  next: number;
  lateDone: boolean;
  radius: number;
}

/**
 * Everything the map draws, outside React. Three canvases: the land lattice (baked; redrawn per frame only during the
 * first reveal), the marks (points, the preview line and pulse, the sweep and the implosions; it reaches 8 px past
 * the map) and a larger effects layer for the sparks, which may fly past the map's edge.
 */
class SessionsMap {
  /** Called on the frame the front reaches sessions (several at once when they share a place). */
  onHit: (ids: readonly string[]) => void = () => undefined;
  /** Called once every session of the sweep has been hit. */
  onSwept: () => void = () => undefined;

  private ink: GeoInk | null = null;
  private batch: DotBatch | null = null;
  private landStyle = "";
  private box: { width: number; height: number; dpr: number } | null = null;
  private projection: MapProjection | null = null;
  private lattice: DotLattice | null = null;
  /** 1 for land dots of the lattice, 0 for sea dots (shown only while lit). */
  private land = new Uint8Array(0);
  private points: MapPoint[] = [];
  private readonly imploded = new Set<string>();
  private previewId: string | null = null;
  private arcs: Arc[] = [];
  private pulses: Pulse[] = [];
  private implosions: Implosion[] = [];
  private wave: Wave | null = null;
  private originFlash = -Infinity;
  private readonly sparks = new Sparks();
  private reveal: "waiting" | "running" | "done" = "waiting";
  private revealStart = 0;
  private revealThreshold = new Float32Array(0);
  private revealOrigin = { x: 0, y: 0, reach: 1 };
  private effectsX = 0;
  private effectsY = 0;
  private dirty = true;
  private baseDirty = true;
  private effectsDirty = false;
  private wasMoving = false;
  private readonly scratch = createScreenPoint();

  /** New theme colours: the ramp, the baked land and the marks follow. */
  setInk(ink: GeoInk) {
    this.ink = ink;
    this.landStyle = rgba(ink.land);
    // the brightest lit dot: the glint on a dark card, the shine (a deeper violet) on a light one
    const ramp = [ink.land, ink.accent, ink.hot];
    if (this.batch) this.batch.setRamp(ramp);
    else this.batch = createDotBatch(2048, ramp, { tones: 24, levels: 16 });
    this.baseDirty = true;
    this.dirty = true;
  }

  /** New map size: projection, lattice and points follow. A sweep in flight finishes at once. */
  layout(width: number, height: number, dpr: number) {
    this.box = { width, height, dpr };
    const projection = createProjection("equalEarth", { width, height, latRange: LAT_RANGE });
    const grid = mapLattice(projection, { pitch: PITCH, landOnly: false });
    const landGrid = mapLattice(projection, { pitch: PITCH });
    // both lattices share the frame-anchored grid, so row and column identify a dot
    const keys = new Set<number>();
    for (let i = 0; i < landGrid.count; i++) keys.add(landGrid.row[i] * 4096 + landGrid.column[i]);
    const land = new Uint8Array(grid.count);
    for (let i = 0; i < grid.count; i++) land[i] = keys.has(grid.row[i] * 4096 + grid.column[i]) ? 1 : 0;
    this.projection = projection;
    this.lattice = grid;
    this.land = land;
    for (const point of this.points) this.place(point);
    this.pulses = [];
    this.arcs = this.arcs.filter((arc) => arc.fade < 0).map((arc) => this.arcTo(arc.id, arc.start) ?? arc);
    if (this.wave) this.finishSweep();
    if (this.reveal === "running") this.prepareReveal();
    this.baseDirty = true;
    this.dirty = true;
  }

  /** The marks canvas was resized (and cleared). */
  invalidate() {
    this.dirty = true;
  }

  /** Position of the map's top-left corner on the effects layer. */
  setEffectsOffset(x: number, y: number) {
    this.effectsX = x;
    this.effectsY = y;
  }

  /** The sessions to show. Points keep their highlight across updates; leaving sessions are not drawn. */
  setSessions(sessions: readonly Session[], leaving: ReadonlySet<string>) {
    const previous = new Map(this.points.map((point) => [point.id, point]));
    const points: MapPoint[] = [];
    for (const session of sessions) {
      const coordinates = coordinatesOf(session);
      if (!coordinates) continue;
      const old = previous.get(session.id);
      const point: MapPoint = {
        id: session.id,
        lat: coordinates.lat,
        lon: coordinates.lon,
        current: session.current === true,
        approximate: session.approximate === true,
        x: old?.x ?? 0,
        y: old?.y ?? 0,
        gone: leaving.has(session.id) || this.imploded.has(session.id),
        highlight: old?.highlight ?? { position: 0, velocity: 0 },
      };
      this.place(point);
      points.push(point);
    }
    this.points = points;
    this.dirty = true;
  }

  /** Sessions that left for good (or came back): their points may show again when they are listed. */
  forget(ids: readonly string[]) {
    for (const id of ids) this.imploded.delete(id);
  }

  /** Previews a session: its point pulses twice and a dotted line draws to it from this device. */
  setPreview(id: string | null) {
    if (id === this.previewId) return;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    for (const arc of this.arcs) if (arc.fade < 0) arc.fade = reduced ? now - ARC_FADE_MS : now;
    this.previewId = id;
    this.dirty = true;
    const point = id ? this.find(id) : undefined;
    if (!point || point.gone || !id) return;
    if (!reduced) this.pulses.push({ x: point.x, y: point.y, start: now });
    const arc = this.arcTo(id, reduced ? now - ARC_MS : now);
    if (arc) this.arcs.push(arc);
  }

  /** The nearest visible point within `radius` px of (x, y), or null. */
  nearest(x: number, y: number, radius: number) {
    const visible = this.points.filter((point) => !point.gone);
    const xs = visible.map((point) => point.x);
    const ys = visible.map((point) => point.y);
    const index = nearestIndex(xs, ys, visible.length, x, y, radius);
    return index >= 0 ? visible[index].id : null;
  }

  /** A single sign-out: the point implodes into sparks, without the wave. */
  implode(id: string) {
    this.hit([id], performance.now(), false);
  }

  /**
   * Starts the sweep: a front expands from this device (or the map centre) and hits each session as it reaches it.
   * Without a laid-out map, or with reduced motion, every session is hit at once.
   */
  sweep(ids: readonly string[]) {
    const box = this.box;
    const lattice = this.lattice;
    if (!box || !lattice || prefersReducedMotion()) {
      this.onHit(ids);
      this.onSwept();
      return;
    }
    const origin = this.origin() ?? { x: box.width / 2, y: box.height / 2 };
    const distances = new Float32Array(lattice.count);
    for (let i = 0; i < lattice.count; i++) distances[i] = Math.hypot(lattice.x[i] - origin.x, lattice.y[i] - origin.y);
    const reach = Math.max(
      Math.hypot(origin.x, origin.y),
      Math.hypot(box.width - origin.x, origin.y),
      Math.hypot(origin.x, box.height - origin.y),
      Math.hypot(box.width - origin.x, box.height - origin.y),
    );
    const located: { id: string; distance: number }[] = [];
    const late: string[] = [];
    for (const id of ids) {
      const point = this.find(id);
      if (point && !point.gone) located.push({ id, distance: Math.hypot(point.x - origin.x, point.y - origin.y) });
      else late.push(id);
    }
    located.sort((a, b) => a.distance - b.distance);
    const targets: WaveTarget[] = [];
    for (const item of located) {
      const last = targets[targets.length - 1];
      // sessions at the same place go on the same frame
      if (last && item.distance - last.distance < 0.5) last.ids.push(item.id);
      else targets.push({ ids: [item.id], distance: item.distance });
    }
    const now = performance.now();
    this.wave = {
      start: now,
      x: origin.x,
      y: origin.y,
      reach,
      distances,
      targets,
      late,
      next: 0,
      lateDone: false,
      radius: 0,
    };
    this.originFlash = now;
    this.dirty = true;
  }

  /** Hits every session the sweep has not reached yet and ends it. */
  finishSweep() {
    const wave = this.wave;
    if (!wave) return;
    const now = performance.now();
    while (wave.next < wave.targets.length) this.hit(wave.targets[wave.next++].ids, now, true);
    if (!wave.lateDone) {
      wave.lateDone = true;
      if (wave.late.length) this.onHit(wave.late);
      this.onSwept();
    }
    this.wave = null;
    this.dirty = true;
  }

  /** One frame. Returns whether to keep going. */
  step(base: CanvasSurface | null, marks: CanvasSurface | null, effects: CanvasSurface | null, delta: number) {
    if (!this.lattice || !this.ink || !this.batch || !this.box || !base || !marks) return false;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    let moving = false;

    // The land prints itself once, outward from this device, the first time the map is on screen.
    let front = Infinity;
    if (this.reveal !== "done") {
      if (reduced) {
        this.reveal = "done";
        this.baseDirty = true;
      } else {
        if (this.reveal === "waiting") {
          this.reveal = "running";
          this.revealStart = now;
          this.prepareReveal();
        }
        const t = (now - this.revealStart) / REVEAL_MS;
        if (t >= 1) {
          this.reveal = "done";
          this.baseDirty = true;
          this.dirty = true;
        } else {
          front = easeOutCubic(t) * REVEAL_END;
          this.drawReveal(base, front);
          moving = true;
        }
      }
    }
    if (this.reveal === "done" && this.baseDirty) {
      this.bake(base);
      this.baseDirty = false;
    }

    for (const point of this.points) {
      if (settleSpring(point.highlight, point.id === this.previewId ? 1 : 0, delta, reduced, HIGHLIGHT_SPRING))
        moving = true;
    }
    if (this.wave && this.advanceWave(this.wave, now)) moving = true;
    if (this.arcs.length) {
      this.arcs = this.arcs.filter((arc) => arc.fade < 0 || now - arc.fade < ARC_FADE_MS);
      if (this.arcs.some((arc) => arc.fade >= 0 || now - arc.start < ARC_MS)) moving = true;
    }
    if (this.pulses.length) {
      this.pulses = this.pulses.filter((pulse) => now - pulse.start < PULSE_MS);
      if (this.pulses.length) moving = true;
    }
    if (this.implosions.length) {
      for (const implosion of this.implosions) {
        if (!implosion.burst && now - implosion.start >= IMPLODE_MS) {
          implosion.burst = true;
          this.burst(implosion.x, implosion.y);
        }
      }
      this.implosions = this.implosions.filter((implosion) => now - implosion.start < IMPLODE_MS + FLASH_MS);
      if (this.implosions.length) moving = true;
    }
    if (now - this.originFlash < ORIGIN_FLASH_MS) moving = true;

    // one more frame after the last movement, so everything rests at its final state
    if (this.dirty || moving || this.wasMoving) {
      this.drawMarks(marks, now, front);
      this.dirty = false;
    }
    this.wasMoving = moving;
    const sparking = effects ? this.drawEffects(effects, delta) : false;
    return moving || sparking;
  }

  /* internals */

  private find(id: string) {
    return this.points.find((point) => point.id === id);
  }

  /** This device's point, the origin of preview lines and of the sweep. */
  private origin() {
    return this.points.find((point) => point.current && !point.gone);
  }

  private place(point: MapPoint) {
    if (!this.projection) return;
    this.projection.project(point.lat, wrapLongitude(point.lon), this.scratch);
    point.x = this.scratch.x;
    point.y = this.scratch.y;
  }

  /** A dotted line from this device to the session, bowing toward the north in either direction. */
  private arcTo(id: string, start: number): Arc | null {
    const origin = this.origin();
    const point = this.find(id);
    const projection = this.projection;
    if (!origin || !point || point === origin || !projection) return null;
    if (Math.hypot(point.x - origin.x, point.y - origin.y) < 4) return null;
    const east = angleDelta(origin.lon, point.lon) >= 0;
    return { id, tables: flatPaths(projection, origin, point, { bend: east ? ARC_BEND : -ARC_BEND }), start, fade: -1 };
  }

  private hit(ids: readonly string[], now: number, notify: boolean) {
    for (const id of ids) {
      const point = this.find(id);
      if (!point || point.gone) continue;
      point.gone = true;
      this.imploded.add(id);
      if (!prefersReducedMotion()) this.implosions.push({ x: point.x, y: point.y, start: now, burst: false });
    }
    this.dirty = true;
    if (notify) this.onHit(ids);
  }

  private advanceWave(wave: Wave, now: number) {
    wave.radius = (Math.max(0, now - wave.start - WAVE_CHARGE_MS) / 1000) * WAVE_SPEED;
    while (wave.next < wave.targets.length && wave.targets[wave.next].distance <= wave.radius) {
      this.hit(wave.targets[wave.next].ids, now, true);
      wave.next++;
    }
    if (!wave.lateDone && wave.next >= wave.targets.length && (wave.late.length === 0 || wave.radius >= wave.reach)) {
      wave.lateDone = true;
      if (wave.late.length) this.onHit(wave.late);
      this.onSwept();
    }
    if (wave.radius > wave.reach + WAVE_TAIL * 3 + WAVE_WIDTH * 2) {
      this.wave = null;
      return false;
    }
    return true;
  }

  private burst(x: number, y: number) {
    const ink = this.ink;
    if (!ink) return;
    this.sparks.add(x + this.effectsX, y + this.effectsY, 10, [ink.accent, ink.glint], IMPLODE_SPARKS);
  }

  /** Reveal thresholds: distance from this device (or the middle), plus each dot's jitter for an uneven front. */
  private prepareReveal() {
    const lattice = this.lattice;
    const box = this.box;
    if (!lattice || !box) return;
    const origin = this.origin() ?? { x: box.width / 2, y: box.height / 2 };
    const reach = Math.max(
      Math.hypot(origin.x, origin.y),
      Math.hypot(box.width - origin.x, origin.y),
      Math.hypot(origin.x, box.height - origin.y),
      Math.hypot(box.width - origin.x, box.height - origin.y),
    );
    this.revealOrigin = { x: origin.x, y: origin.y, reach: Math.max(1, reach) };
    const threshold = new Float32Array(lattice.count);
    for (let i = 0; i < lattice.count; i++) {
      const n = Math.hypot(lattice.x[i] - origin.x, lattice.y[i] - origin.y) / this.revealOrigin.reach;
      threshold[i] = n * 0.82 + lattice.jitter[i] * 0.18;
    }
    this.revealThreshold = threshold;
  }

  /** Queues a dot on the batch, snapped to device pixels so 1.5 px squares stay crisp. */
  private add(x: number, y: number, size: number, tone: number, alpha: number) {
    const batch = this.batch;
    if (!batch) return;
    const dpr = this.box?.dpr ?? 1;
    const s = Math.max(1, Math.round(size * dpr)) / dpr;
    batch.add(Math.round((x - s / 2) * dpr) / dpr + s / 2, Math.round((y - s / 2) * dpr) / dpr + s / 2, s, tone, alpha);
  }

  private bake(surface: CanvasSurface) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    context.clearRect(0, 0, width, height);
    if (!lattice) return;
    const dpr = this.box?.dpr ?? surface.dpr;
    const s = Math.max(1, Math.round(DOT * dpr)) / dpr;
    context.fillStyle = this.landStyle;
    for (let i = 0; i < lattice.count; i++) {
      if (!this.land[i]) continue;
      context.fillRect(
        Math.round((lattice.x[i] - s / 2) * dpr) / dpr,
        Math.round((lattice.y[i] - s / 2) * dpr) / dpr,
        s,
        s,
      );
    }
  }

  /** The first reveal: land dots appear behind an uneven front that is tinted with the accent as it passes. */
  private drawReveal(surface: CanvasSurface, front: number) {
    const { context, width, height } = surface;
    const lattice = this.lattice;
    const batch = this.batch;
    context.clearRect(0, 0, width, height);
    if (!lattice || !batch) return;
    for (let i = 0; i < lattice.count; i++) {
      if (!this.land[i]) continue;
      const passed = front - this.revealThreshold[i];
      const appear = clamp(passed / REVEAL_BAND, 0, 1);
      if (appear <= 0) continue;
      const flash = Math.exp(-passed / 0.05);
      this.add(lattice.x[i], lattice.y[i], DOT + 0.5 * flash, 0.5 * flash, appear);
    }
    batch.flush(context);
  }

  private drawMarks(surface: CanvasSurface, now: number, front: number) {
    const { context, width, height } = surface;
    const batch = this.batch;
    context.clearRect(0, 0, width, height);
    if (!batch) return;
    context.save();
    context.translate(MARK_PAD, MARK_PAD);
    if (this.wave || this.pulses.length) this.drawLattice(now);
    for (const arc of this.arcs) this.drawArc(arc, now);
    batch.flush(context);
    this.drawPoints(context, now, front);
    for (const implosion of this.implosions) this.drawImplosion(implosion, now);
    batch.flush(context);
    context.restore();
  }

  /** Lattice dots lit by the sweep's front and tail and by the preview pulses. Sea dots show only while lit. */
  private drawLattice(now: number) {
    const lattice = this.lattice;
    if (!lattice) return;
    const wave = this.wave;
    const radius = wave ? wave.radius : 0;
    // the front loses a little strength as it travels
    const amplitude = wave ? 1 - 0.3 * clamp(radius / wave.reach, 0, 1) : 0;
    const pulses = this.pulses;
    for (let i = 0; i < lattice.count; i++) {
      const x = lattice.x[i];
      const y = lattice.y[i];
      const jitter = lattice.jitter[i];
      let edge = 0;
      let glow = 0;
      if (wave) {
        const d = wave.distances[i];
        edge = ringFront(d, radius, WAVE_WIDTH, jitter, WAVE_UNEVEN) * amplitude;
        const behind = radius - d - jitter * WAVE_UNEVEN;
        const tail = behind > 0 ? WAVE_TAIL_LEVEL * Math.exp(-behind / WAVE_TAIL) * amplitude : 0;
        glow = Math.max(edge, tail);
      }
      for (const pulse of pulses) {
        const dx = x - pulse.x;
        const dy = y - pulse.y;
        if (Math.abs(dx) > PULSE_RADIUS + 8 || Math.abs(dy) > PULSE_RADIUS + 8) continue;
        const d = Math.hypot(dx, dy);
        const age = (now - pulse.start) / 1000;
        for (let ring = 0; ring < 2; ring++) {
          const t = (age - ring * PULSE_GAP_S) / PULSE_RING_S;
          if (t < 0 || t >= 1) continue;
          const value = ringFront(d, 2 + PULSE_RADIUS * easeOutCubic(t), 2.4, jitter, 2.5) * Math.pow(1 - t, 1.4);
          edge = Math.max(edge, value);
          glow = Math.max(glow, value);
        }
      }
      if (glow < 0.03) continue;
      const alpha = this.land[i] ? smoothstep(0.03, 0.3, glow) : glow * SEA_ALPHA;
      this.add(x, y, DOT + edge, glow, alpha);
    }
  }

  /** The preview line: dotted, brighter toward the session, with a lit head while it draws on. */
  private drawArc(arc: Arc, now: number) {
    const progress = ARC_EASE(clamp((now - arc.start) / ARC_MS, 0, 1));
    const fade = arc.fade < 0 ? 1 : 1 - clamp((now - arc.fade) / ARC_FADE_MS, 0, 1);
    if (fade <= 0) return;
    for (const table of arc.tables) {
      const drawn = table.length * progress;
      const length = Math.max(1, table.length);
      forEachDot(table, ARC_SPACING, 0, drawn, (x, y, s) => {
        const head = progress < 1 ? Math.exp(-(drawn - s) / 10) : 0;
        const along = s / length;
        this.add(x, y, DOT + 0.5 * head, 0.5 + 0.5 * head, fade * clamp(0.38 + 0.52 * along + 0.4 * head, 0, 1));
      });
    }
  }

  private drawPoints(context: CanvasRenderingContext2D, now: number, front: number) {
    const ink = this.ink;
    if (!ink) return;
    const dpr = this.box?.dpr ?? 1;
    const revealing = Number.isFinite(front);
    const { x: ox, y: oy, reach } = this.revealOrigin;
    // quiet points first, then the previewed one, then this device on top
    for (let pass = 0; pass < 3; pass++) {
      for (const point of this.points) {
        if (point.gone) continue;
        const rank = point.current ? 2 : point.highlight.position > 0.01 ? 1 : 0;
        if (rank !== pass) continue;
        let scale = 1;
        if (revealing) {
          const threshold = (Math.hypot(point.x - ox, point.y - oy) / reach) * 0.82 + 0.09;
          const appear = clamp((front - threshold) / 0.1, 0, 1);
          if (appear <= 0) continue;
          scale = easeOutBack(appear, 2.2);
        }
        const highlight = clamp(point.highlight.position, 0, 1);
        if (point.approximate) {
          context.fillStyle = rgba(mixRgb(ink.landStrong, ink.accent, highlight));
          context.globalAlpha = (0.75 + 0.25 * highlight) * Math.min(1, scale);
          for (let i = 0; i < APPROX_DOTS; i++) {
            const angle = (i / APPROX_DOTS) * Math.PI * 2;
            fillSquare(
              context,
              point.x + Math.cos(angle) * APPROX_RADIUS * scale,
              point.y + Math.sin(angle) * APPROX_RADIUS * scale,
              1,
              dpr,
            );
          }
          context.globalAlpha = 1;
        }
        if (point.current) {
          this.drawCurrent(context, point, scale, now, dpr);
          continue;
        }
        context.fillStyle = rgba(mixRgb(ink.landStrong, ink.accent, highlight));
        fillSquare(context, point.x, point.y, (POINT + point.highlight.position) * scale, dpr);
      }
    }
  }

  /** This device: a 6 px accent square in a 1 px ring. When the sweep starts it flares and the ring expands. */
  private drawCurrent(context: CanvasRenderingContext2D, point: MapPoint, scale: number, now: number, dpr: number) {
    const ink = this.ink;
    if (!ink) return;
    const flash = (now - this.originFlash) / ORIGIN_FLASH_MS;
    const peak = ink.hot;
    if (flash >= 0 && flash < 1) {
      const k = easeOutCubic(flash);
      context.fillStyle = rgba(ink.accent);
      context.globalAlpha = 0.7 * (1 - flash);
      squareRing(context, point.x, point.y, CURRENT_RING + 22 * k, dpr);
    }
    const flare = flash >= 0 && flash < 1 ? Math.exp(-flash * 5) : 0;
    context.globalAlpha = 0.45 * Math.min(1, scale);
    context.fillStyle = rgba(ink.accent);
    squareRing(context, point.x, point.y, CURRENT_RING * scale, dpr);
    context.globalAlpha = 1;
    context.fillStyle = rgba(mixRgb(ink.accent, peak, flare));
    fillSquare(context, point.x, point.y, (CURRENT_POINT + 2 * flare) * scale, dpr);
  }

  /** A session's point breaks into the dots of a 5 px disc that fall into the centre, then a short flash. */
  private drawImplosion(implosion: Implosion, now: number) {
    const t = (now - implosion.start) / IMPLODE_MS;
    if (t < 1) {
      const k = easeInCubic(t);
      for (let i = 0; i < IMPLODE_DOTS; i++) {
        const angle = i * GOLDEN_ANGLE;
        const radius = IMPLODE_RADIUS * Math.sqrt((i + 0.5) / IMPLODE_DOTS) * (1 - k);
        this.add(
          implosion.x + Math.cos(angle) * radius,
          implosion.y + Math.sin(angle) * radius,
          1.25,
          0.45 + 0.55 * k,
          1,
        );
      }
      return;
    }
    const f = clamp((now - implosion.start - IMPLODE_MS) / FLASH_MS, 0, 1);
    this.add(implosion.x, implosion.y, 1 + 4 * (1 - f), 1, 1 - f);
  }

  private drawEffects(surface: CanvasSurface, delta: number) {
    const { context, width, height } = surface;
    if (!this.sparks.active) {
      if (this.effectsDirty) {
        context.clearRect(0, 0, width, height);
        this.effectsDirty = false;
      }
      return false;
    }
    context.clearRect(0, 0, width, height);
    this.effectsDirty = true;
    return this.sparks.step(context, delta);
  }
}

/** Valid coordinates of a session, or null when it has none. */
function coordinatesOf(session: Session) {
  const { lat, lon } = session;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90) return null;
  return { lat: clamp(lat, LAT_RANGE[0], LAT_RANGE[1]), lon: wrapLongitude(lon) };
}

/** A 1 px square ring of outer `size` CSS px centred on (x, y), drawn as four snapped bars. */
function squareRing(context: CanvasRenderingContext2D, x: number, y: number, size: number, dpr: number) {
  const s = Math.max(2, Math.round(size * dpr)) / dpr;
  const line = 1;
  const left = Math.round((x - s / 2) * dpr) / dpr;
  const top = Math.round((y - s / 2) * dpr) / dpr;
  context.fillRect(left, top, s, line);
  context.fillRect(left, top + s - line, s, line);
  context.fillRect(left, top + line, line, s - line * 2);
  context.fillRect(left + s - line, top + line, line, s - line * 2);
}

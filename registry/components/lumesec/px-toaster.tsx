"use client";

import * as React from "react";

import { clamp } from "@/lib/lumesec/math";
import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { usePixelCanvas, type PixelFrame } from "@/lib/lumesec/pixel-canvas";
import { STATUS_COLORS, STATUS_ICONS, type StatusTone } from "@/lib/lumesec/pixel-font";
import { cn } from "@/lib/utils";

/** Toast type: picks the pixel icon and the colour. */
export type PxToastType = StatusTone;

/** Viewport corner the stack is pinned to. */
export type PxToasterPosition = "bottom-right" | "bottom-left" | "top-right";

/** A button on the toast. Clicking it calls `onClick` and dismisses the toast. */
export interface PxToastAction {
  /** Button text. */
  label: string;
  /** Called when the button is clicked, before the toast is dismissed. */
  onClick?: () => void;
}

/** What `show()` accepts. */
export interface PxToastOptions {
  /** Bold first line. */
  title?: React.ReactNode;
  /** Muted second line. */
  description?: React.ReactNode;
  /** Default `info`. */
  type?: PxToastType;
  /** Milliseconds before the toast leaves, default 4500. 0 or less keeps it until dismissed. */
  duration?: number;
  /** Optional action button. */
  action?: PxToastAction;
}

/** Imperative handle of `PxToaster`, passed through `ref`. */
export interface PxToasterHandle {
  /** Adds a toast and returns its id. Showing more than `max` dismisses the oldest. */
  show(toast?: PxToastOptions): number;
  /** Starts the exit of the toast with that id. Unknown or leaving ids are ignored. */
  dismiss(id: number): void;
}

/** Props of `PxToaster`. Other `div` props go to the root element; `ref` is the handle. */
export interface PxToasterProps extends Omit<React.ComponentProps<"div">, "ref" | "children"> {
  /** Handle with `show()` and `dismiss()`. */
  ref?: React.Ref<PxToasterHandle>;
  /** Pins the stack to a viewport corner with `position: fixed`, up to 360 px wide. Without it the stack stays in the flow. */
  position?: PxToasterPosition;
  /** Maximum toasts on screen, at least 1; one more dismisses the oldest. */
  max?: number;
  /** Called when a toast is added. */
  onShow?: (id: number, type: PxToastType) => void;
  /** Called when a toast starts leaving: timer, dismiss button, action button, overflow or `dismiss()`. */
  onDismiss?: (id: number) => void;
}

interface ToastRecord {
  id: number;
  type: PxToastType;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: PxToastAction;
  leaving: boolean;
}

/**
 * A toast's countdown. It runs on a timeout rather than in the canvas loop, so toasts expire on time while
 * the stack is off screen; the loop only draws the bar.
 */
interface ToastTimer {
  /** Full duration in ms; 0 or less never expires. */
  duration: number;
  /** Time left in ms when the countdown last started or stopped. */
  remaining: number;
  /** `performance.now()` when the countdown last started, or `null` while it is stopped. */
  startedAt: number | null;
  /** The pending expiry timeout. */
  timeout: number;
}

const DEFAULT_DURATION = 4500;
/** How long a dismissed toast takes to slide out and collapse. */
const EXIT_MS = 320;

const POSITION_CLASSES: Record<PxToasterPosition, string> = {
  "bottom-right": "right-4 bottom-[calc(16px+env(safe-area-inset-bottom,0px))]",
  "bottom-left": "left-4 bottom-[calc(16px+env(safe-area-inset-bottom,0px))]",
  "top-right": "right-4 top-[calc(16px+env(safe-area-inset-top,0px))]",
};

/**
 * Toast stack. Each toast has a pixel type icon and a timer bar that drains along its bottom edge;
 * hovering or focusing the stack pauses every timer. Toasts are added through the `show()` handle, and
 * the stack can be pinned to a viewport corner.
 *
 * @example
 * const toaster = React.useRef<PxToasterHandle>(null);
 * <PxToaster ref={toaster} position="bottom-right" />
 * toaster.current?.show({ title: "Changes saved", type: "success" });
 */
export function PxToaster({ ref, position, max = 4, onShow, onDismiss, className, ...props }: PxToasterProps) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  // the list is also kept in a ref, so several show() calls in one tick see each other
  const list = React.useRef<ToastRecord[]>([]);
  const timers = React.useRef(new Map<number, ToastTimer>());
  const removals = React.useRef(new Map<number, number>());
  const nodes = React.useRef(new Map<number, HTMLLIElement>());
  const regionRef = React.useRef<HTMLDivElement>(null);
  const sequence = React.useRef(0);
  // hover and focus each pause every timer; both have to end before the timers run again
  const hovered = React.useRef(false);
  const focused = React.useRef(false);
  /** Until when (`performance.now()`) the stack is still collapsing around a dismissed toast, so the icons follow it. */
  const settleUntil = React.useRef(0);

  const settings = React.useRef({ max, onShow, onDismiss });
  React.useEffect(() => {
    settings.current = { max, onShow, onDismiss };
  });

  const commit = React.useCallback((next: ToastRecord[]) => {
    list.current = next;
    setToasts(next);
  }, []);

  const { ref: canvasRef, redraw } = usePixelCanvas(draw);

  const scheduleRemoval = React.useCallback(
    (id: number) => {
      const removal = window.setTimeout(
        () => {
          removals.current.delete(id);
          timers.current.delete(id);
          commit(list.current.filter((item) => item.id !== id));
          redraw();
        },
        prefersReducedMotion() ? 0 : EXIT_MS,
      );
      removals.current.set(id, removal);
    },
    [commit, redraw],
  );

  // A leaving toast is inert, which would drop focus to the page. Move focus first: to the close button of
  // the toast below it (ids grow down the stack), else the one above it, else the stack itself.
  const releaseFocus = React.useCallback((id: number) => {
    if (!nodes.current.get(id)?.contains(document.activeElement)) return;
    const others = list.current.filter((item) => !item.leaving && item.id !== id);
    const neighbour = others.find((item) => item.id > id) ?? others.filter((item) => item.id < id).pop();
    const close =
      neighbour && nodes.current.get(neighbour.id)?.querySelector<HTMLElement>('[data-slot="px-toaster-close"]');
    (close || regionRef.current)?.focus();
  }, []);

  const dismiss = React.useCallback(
    (id: number) => {
      const toast = list.current.find((item) => item.id === id);
      if (!toast || toast.leaving) return;
      releaseFocus(id);
      const timer = timers.current.get(id);
      if (timer) stopTimer(timer);
      commit(list.current.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
      scheduleRemoval(id);
      settleUntil.current = performance.now() + EXIT_MS + 40;
      settings.current.onDismiss?.(id);
      redraw();
    },
    [commit, redraw, releaseFocus, scheduleRemoval],
  );

  const startTimer = React.useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (!timer || timer.duration <= 0 || timer.startedAt !== null) return;
      timer.startedAt = performance.now();
      timer.timeout = window.setTimeout(() => dismiss(id), Math.max(0, timer.remaining));
    },
    [dismiss],
  );

  /** Stops every countdown while the stack is hovered or holds focus, and restarts them afterwards. */
  const syncPause = React.useCallback(() => {
    const paused = hovered.current || focused.current;
    for (const toast of list.current) {
      const timer = timers.current.get(toast.id);
      if (!timer || toast.leaving) continue;
      if (paused) stopTimer(timer);
      else startTimer(toast.id);
    }
    redraw();
  }, [redraw, startTimer]);

  const show = React.useCallback(
    (options: PxToastOptions = {}) => {
      const type = options.type && options.type in STATUS_ICONS ? options.type : "info";
      const id = ++sequence.current;
      const duration = options.duration ?? DEFAULT_DURATION;
      timers.current.set(id, { duration, remaining: duration, startedAt: null, timeout: 0 });
      commit([
        ...list.current,
        { id, type, title: options.title, description: options.description, action: options.action, leaving: false },
      ]);
      if (!hovered.current && !focused.current) startTimer(id);
      const live = list.current.filter((item) => !item.leaving);
      if (live.length > Math.max(1, settings.current.max)) dismiss(live[0].id);
      settings.current.onShow?.(id, type);
      redraw();
      return id;
    },
    [commit, dismiss, redraw, startTimer],
  );

  React.useImperativeHandle(ref, () => ({ show, dismiss }), [show, dismiss]);

  React.useEffect(() => {
    // (re)start what the cleanup stopped: StrictMode unmounts and remounts once in development
    for (const toast of list.current) {
      if (toast.leaving) {
        if (!removals.current.has(toast.id)) scheduleRemoval(toast.id);
      } else if (!hovered.current && !focused.current) {
        startTimer(toast.id);
      }
    }
    const pendingTimers = timers.current;
    const pendingRemovals = removals.current;
    return () => {
      pendingTimers.forEach(stopTimer);
      pendingRemovals.forEach((removal) => window.clearTimeout(removal));
      pendingRemovals.clear();
    };
  }, [scheduleRemoval, startTimer]);

  const register = React.useCallback(
    (id: number, node: HTMLLIElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
      // the icon is drawn at the toast's position, which only exists once it is in the DOM
      redraw();
    },
    [redraw],
  );

  // icons and draining timer bars, drawn over the toasts; the timeouts above do the expiring
  function draw({ palette, clear, dot }: PixelFrame) {
    clear();
    const now = performance.now();
    let draining = false;
    for (const toast of list.current) {
      if (toast.leaving) continue;
      const node = nodes.current.get(toast.id);
      if (!node) continue;
      const x0 = node.offsetLeft;
      const y0 = node.offsetTop;
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const color = palette[STATUS_COLORS[toast.type]];
      for (const [x, y] of STATUS_ICONS[toast.type]) dot(x0 + 13 + x * 2.4, y0 + 13 + y * 2.4, color, 1, 2.1);
      const timer = timers.current.get(toast.id);
      if (timer && timer.duration > 0) {
        const running = timer.startedAt !== null;
        if (running) draining = true;
        const share = clamp(timeLeft(timer, now) / timer.duration, 0, 1);
        for (let x = x0 + 6; x < x0 + 6 + (width - 12) * share; x += 3)
          dot(x, y0 + height - 5, color, running ? 0.8 : 0.35, 2);
      }
    }
    return draining || now < settleUntil.current;
  }

  return (
    <div
      data-slot="px-toaster"
      data-position={position}
      className={cn(
        "block text-foreground",
        position && "pointer-events-none fixed z-[1000] w-[min(360px,calc(100vw-32px))]",
        position && POSITION_CLASSES[position],
        className,
      )}
      {...props}
    >
      {/* focusable from code only: it takes focus when the last toast holding focus leaves */}
      <div
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        tabIndex={-1}
        className="relative outline-none"
        onPointerEnter={() => {
          hovered.current = true;
          syncPause();
        }}
        onPointerLeave={() => {
          hovered.current = false;
          syncPause();
        }}
        onFocus={() => {
          focused.current = true;
          syncPause();
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          focused.current = false;
          syncPause();
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] block h-full w-full [image-rendering:pixelated]"
        />
        {/* the only live region: toasts carry no role of their own, so each one is announced once */}
        <ol aria-live="polite" className="m-0 flex list-none flex-col gap-2 p-0">
          {toasts.map((toast) => (
            <Toast key={toast.id} toast={toast} register={register} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Stops a running countdown and keeps the time it had left. */
function stopTimer(timer: ToastTimer) {
  if (timer.startedAt === null) return;
  window.clearTimeout(timer.timeout);
  timer.remaining -= performance.now() - timer.startedAt;
  timer.startedAt = null;
}

/** Milliseconds a countdown has left at `now`. */
function timeLeft(timer: ToastTimer, now: number) {
  return timer.startedAt === null ? timer.remaining : timer.remaining - (now - timer.startedAt);
}

const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(14px) scale(.96)" },
  { opacity: 1, transform: "none" },
];

/** One toast. The icon and timer bar are drawn by the stack's canvas, over the empty first column. */
function Toast({
  toast,
  register,
  onDismiss,
}: {
  toast: ToastRecord;
  register: (id: number, node: HTMLLIElement | null) => void;
  onDismiss: (id: number) => void;
}) {
  const node = React.useRef<HTMLLIElement>(null);
  const { id, type, title, description, action, leaving } = toast;

  React.useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    register(id, element);
    if (!prefersReducedMotion())
      element.animate(ENTER_KEYFRAMES, { duration: 320, easing: "cubic-bezier(.2,.9,.3,1.15)" });
    return () => register(id, null);
  }, [id, register]);

  return (
    <li
      ref={node}
      data-state={leaving ? "closed" : "open"}
      data-type={type}
      inert={leaving}
      className={cn(
        "pointer-events-auto grid max-h-[140px] grid-cols-[20px_1fr_auto] items-start gap-2.5 overflow-hidden rounded-xl border border-border bg-card pt-3 pr-2.5 pb-3.5 pl-3 shadow-[0_12px_28px_-16px_rgba(0,0,0,.5)]",
        "[transition:opacity_.25s,transform_.3s,margin_.3s,max-height_.3s,padding_.3s] motion-reduce:transition-none",
        leaving && "-mb-2 max-h-0 [transform:translateX(24px)] pt-0 pb-0 opacity-0",
      )}
    >
      <span />
      <span className="grid min-w-0 gap-[2px]">
        <b className="text-[13.5px] font-semibold">{title}</b>
        {description ? <span className="text-[12.5px] text-muted-foreground">{description}</span> : null}
      </span>
      <span className="flex items-center gap-1">
        {action ? (
          <button
            type="button"
            onClick={() => {
              action.onClick?.();
              onDismiss(id);
            }}
            className={cn(
              "inline-flex h-[26px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-[9px] font-[inherit] text-[12px] font-medium whitespace-nowrap text-foreground select-none hover:bg-muted",
              "[transition:transform_.15s_cubic-bezier(.2,.8,.2,1),background-color_.2s,border-color_.2s,color_.2s] active:[transform:scale(.95)]",
              "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
            )}
          >
            {action.label}
          </button>
        ) : null}
        <button
          type="button"
          data-slot="px-toaster-close"
          aria-label="Dismiss"
          onClick={() => onDismiss(id)}
          className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground outline-none select-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
        >
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="size-[11px] fill-none stroke-current [stroke-width:1.8] [stroke-linecap:round]"
          >
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </span>
    </li>
  );
}

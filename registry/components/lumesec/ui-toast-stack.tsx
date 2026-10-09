"use client";

import * as React from "react";

import { useInterval, useReducedMotion } from "@/lib/lumesec/motion";
import { cn } from "@/lib/utils";

/** Colour of a toast's status dot. */
export type ToastTone = "accent" | "success" | "warning" | "destructive";

/** A toast to show. */
export interface ToastInput {
  /** First line, truncated with an ellipsis. */
  title: string;
  /** Second line, muted, truncated with an ellipsis. */
  description?: string;
  /** Dot colour. Default `accent`. */
  tone?: ToastTone;
}

/** Imperative actions on the stack, exposed through `ref`. */
export interface UiToastStackHandle {
  /** Show a toast, or the next built-in sample when called without an argument. */
  show(toast?: ToastInput): void;
}

export interface UiToastStackProps extends Omit<React.ComponentProps<"div">, "ref"> {
  /** Render the "Show toast" button under the stack. */
  trigger?: boolean;
  /** Exposes `show()`. */
  ref?: React.Ref<UiToastStackHandle>;
}

interface ToastItem {
  id: number;
  title: string;
  description: string;
  tone: ToastTone;
  /** Still at its starting position below the stack, for one frame. */
  entering: boolean;
  /** Horizontal drag offset in px. */
  dx: number;
  dragging: boolean;
  /** Vertical position the drag started from. */
  dragY: number;
  /** Where a dismissed toast flies to; it keeps its stacking and text visibility while it leaves. */
  leaving: null | { how: "down" | "away"; y: number; x: number; z: number; bodyVisible: boolean };
}

const SAMPLES: readonly Required<ToastInput>[] = [
  { title: "Artifact published", description: "Effort Slider is live at its link.", tone: "accent" },
  { title: "Copied to clipboard", description: "npx shadcn add @lumesec/effort-slider", tone: "success" },
  { title: "Connector added", description: "Google Drive is ready to use.", tone: "success" },
  { title: "Upload failed", description: "report.pdf is over the 30 MB limit.", tone: "destructive" },
  { title: "Memory updated", description: "Saved your preference for German labels.", tone: "accent" },
  { title: "3 files uploaded", description: "brief.docx, deck.pdf, notes.md", tone: "success" },
];

const LIFE_MS = 5000;
const TICK_MS = 100;
const MAX_KEPT = 5;
const MAX_VISIBLE = 3;

const TONE_CLASS: Record<ToastTone, string> = {
  accent: "bg-lumesec ring-lumesec/20",
  success: "bg-lumesec-success ring-lumesec-success/20",
  warning: "bg-lumesec-warning ring-lumesec-warning/20",
  destructive: "bg-destructive ring-destructive/20",
};

/**
 * Toast stack where new toasts spring up from below, hover or focus fans the stack out and pauses timers,
 * and a sideways swipe dismisses. Show toasts through `ref`.
 *
 * @example
 * const toasts = React.useRef<UiToastStackHandle>(null);
 * <UiToastStack ref={toasts} trigger={false} />
 * <button onClick={() => toasts.current?.show({ title: "Saved", description: "All changes are stored." })}>Save</button>
 */
export function UiToastStack({ trigger = true, ref, className, ...props }: UiToastStackProps) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const reduced = useReducedMotion();
  const idPrefix = React.useId();
  const regionRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const toastNodes = React.useRef(new Map<number, HTMLDivElement>());
  const dismissButtons = React.useRef(new Map<number, HTMLButtonElement>());
  /** Remaining life per toast in ms, counted down by the timer while the stack is collapsed. */
  const lives = React.useRef(new Map<number, number>());
  /** Where and when (event time stamp in ms) each held toast was grabbed. */
  const drags = React.useRef(new Map<number, { x: number; time: number }>());
  const removals = React.useRef(new Set<number>());
  const nextId = React.useRef(0);
  const nextSample = React.useRef(0);
  const latest = React.useRef({ toasts, expanded });
  React.useEffect(() => {
    latest.current = { toasts, expanded };
  });

  React.useEffect(() => {
    const pending = removals.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  /**
   * When the focused toast leaves, focus moves to the toast behind it, else the newer one, else the trigger, else
   * the stack itself, so it never drops to the page.
   */
  const keepFocus = React.useCallback((id: number) => {
    const live = latest.current.toasts.filter((toast) => !toast.leaving);
    const position = live.findIndex((toast) => toast.id === id);
    const neighbour = live[position - 1] ?? live[position + 1];
    const target = (neighbour && dismissButtons.current.get(neighbour.id)) ?? triggerRef.current ?? regionRef.current;
    target?.focus();
  }, []);

  const dismiss = React.useCallback(
    (id: number, how: "down" | "away", width = 0) => {
      if (toastNodes.current.get(id)?.contains(document.activeElement)) keepFocus(id);
      const { expanded: fanned } = latest.current;
      setToasts((list) => {
        const live = list.filter((toast) => !toast.leaving);
        const position = live.findIndex((toast) => toast.id === id);
        if (position < 0) return list;
        const index = live.length - 1 - position;
        return list.map((toast) => {
          if (toast.id !== id) return toast;
          const y = toast.dragging ? toast.dragY : restingY(index, fanned);
          const x = how === "away" ? (Math.sign(toast.dx) || 1) * (width + 60) : 0;
          const bodyVisible = fanned || index === 0;
          return { ...toast, dragging: false, leaving: { how, y, x, z: 100 - index, bodyVisible } };
        });
      });
      lives.current.delete(id);
      const timer = window.setTimeout(() => {
        removals.current.delete(timer);
        setToasts((list) => list.filter((toast) => toast.id !== id));
      }, 340);
      removals.current.add(timer);
    },
    [keepFocus],
  );

  const show = React.useCallback((input?: ToastInput) => {
    const sample = SAMPLES[nextSample.current % SAMPLES.length];
    if (!input) nextSample.current++;
    const toast = input ?? sample;
    const added: ToastItem = {
      id: nextId.current++,
      title: toast.title,
      description: toast.description ?? "",
      tone: toast.tone ?? "accent",
      entering: true,
      dx: 0,
      dragging: false,
      dragY: 0,
      leaving: null,
    };
    setToasts((list) => dropOldest([...list, added]));
  }, []);

  React.useImperativeHandle(ref, () => ({ show }), [show]);

  // A new toast renders once below the stack, invisible, and moves up on the next frame.
  const hasEntering = toasts.some((toast) => toast.entering);
  React.useEffect(() => {
    if (!hasEntering) return;
    const frame = requestAnimationFrame(() => {
      // reading layout commits the start position, so the move up transitions instead of jumping
      regionRef.current?.getBoundingClientRect();
      setToasts((list) => list.map((toast) => (toast.entering ? { ...toast, entering: false } : toast)));
    });
    return () => cancelAnimationFrame(frame);
  }, [hasEntering]);

  // timers pause while the stack is expanded or a toast is held
  useInterval(
    () => {
      const { toasts: current, expanded: paused } = latest.current;
      // forget the lives of toasts dropped to keep the stack at five
      for (const id of lives.current.keys()) {
        if (!current.some((toast) => toast.id === id)) lives.current.delete(id);
      }
      if (paused) return;
      for (const toast of current) {
        if (toast.leaving || toast.dragging) continue;
        const life = (lives.current.get(toast.id) ?? LIFE_MS) - TICK_MS;
        lives.current.set(toast.id, life);
        if (life <= 0) dismiss(toast.id, "down");
      }
    },
    TICK_MS,
    toasts.length > 0,
  );

  const updateToast = (id: number, change: Partial<ToastItem>) =>
    setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, ...change } : toast)));

  /** A swipe of more than 80 px, or a fast flick, throws the toast away; otherwise it springs back. */
  const releaseDrag = (toast: ToastItem, event: React.PointerEvent<HTMLDivElement>) => {
    const drag = drags.current.get(toast.id);
    if (!drag) return;
    drags.current.delete(toast.id);
    const width = event.currentTarget.offsetWidth;
    const velocity = toast.dx / Math.max(1, event.timeStamp - drag.time);
    if (Math.abs(toast.dx) > 80 || Math.abs(velocity) > 0.55) {
      dismiss(toast.id, "away", width);
      return;
    }
    updateToast(toast.id, { dx: 0, dragging: false });
  };

  const live = toasts.filter((toast) => !toast.leaving);

  return (
    <div
      data-slot="ui-toast-stack"
      className={cn("grid justify-items-center gap-4 leading-normal", className)}
      {...props}
    >
      {/* one polite live region for the whole stack: a new toast is announced once, removals are not */}
      <div
        ref={regionRef}
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        // focus lands here when the last toast is dismissed with the keyboard and there is no trigger
        tabIndex={-1}
        className="relative h-[196px] w-[min(340px,100%)] outline-none"
        onPointerEnter={() => setExpanded(true)}
        onPointerLeave={() => {
          if (!regionRef.current?.contains(document.activeElement)) setExpanded(false);
        }}
        onFocus={() => setExpanded(true)}
        onBlur={(event) => {
          if (!regionRef.current?.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        {toasts.map((toast) => {
          const index = toast.leaving ? -1 : live.length - 1 - live.indexOf(toast);
          const visible = index >= 0 && index < MAX_VISIBLE;
          const titleId = `${idPrefix}-title-${toast.id}`;
          return (
            <div
              key={toast.id}
              ref={(node) => {
                if (!node) return;
                toastNodes.current.set(toast.id, node);
                return () => {
                  toastNodes.current.delete(toast.id);
                };
              }}
              data-dragging={toast.dragging ? "" : undefined}
              // a leaving toast is gone for assistive technology and the keyboard
              inert={toast.leaving ? true : undefined}
              className="absolute inset-x-0 bottom-0 flex h-[58px] origin-top cursor-grab touch-pan-y items-center gap-[11px] rounded-xl border border-border bg-card pr-2 pl-3.5 text-foreground shadow-[0_10px_28px_-14px_rgba(0,0,0,.45),0_2px_6px_-3px_rgba(0,0,0,.2)] will-change-transform select-none [transition:transform_.5s_cubic-bezier(.2,.9,.3,1.12),opacity_.35s_ease] data-[dragging]:cursor-grabbing data-[dragging]:transition-none motion-reduce:transition-none"
              style={toastStyle(toast, index, expanded, reduced)}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drags.current.set(toast.id, { x: event.clientX, time: event.timeStamp });
                updateToast(toast.id, { dragging: true, dragY: restingY(index, expanded) });
              }}
              onPointerMove={(event) => {
                const drag = drags.current.get(toast.id);
                if (drag) updateToast(toast.id, { dx: event.clientX - drag.x });
              }}
              onPointerUp={(event) => releaseDrag(toast, event)}
              onPointerCancel={(event) => releaseDrag(toast, event)}
            >
              <span className={cn("size-2 flex-none rounded-[2px] ring-3", TONE_CLASS[toast.tone])} />
              <span
                className="grid min-w-0 flex-1 gap-px [transition:opacity_.25s] motion-reduce:transition-none"
                style={{ opacity: (toast.leaving ? toast.leaving.bodyVisible : expanded || index === 0) ? 1 : 0 }}
              >
                <span id={titleId} className="truncate text-[13.5px] font-medium">
                  {toast.title}
                </span>
                <span className="truncate text-[12.5px] text-muted-foreground">{toast.description}</span>
              </span>
              <button
                ref={(node) => {
                  if (!node) return;
                  dismissButtons.current.set(toast.id, node);
                  return () => {
                    dismissButtons.current.delete(toast.id);
                  };
                }}
                type="button"
                aria-label="Dismiss"
                aria-describedby={titleId}
                tabIndex={visible ? 0 : -1}
                onClick={() => dismiss(toast.id, "down")}
                className="grid size-7 flex-none cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent p-0 text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
              >
                <svg
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="size-3 stroke-current [stroke-width:1.7] [stroke-linecap:round]"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      {trigger && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => show()}
          className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-[9px] border border-border bg-card px-3.5 font-[inherit] text-[13.5px] font-medium text-foreground outline-none select-none [transition:transform_.15s_cubic-bezier(.2,.8,.2,1),background-color_.2s] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid active:[transform:scale(.95)]"
        >
          Show toast
        </button>
      )}
    </div>
  );
}

/** Keep at most `MAX_KEPT` toasts on the stack: the oldest leave at once, without animating. */
function dropOldest(list: ToastItem[]) {
  let excess = list.filter((toast) => !toast.leaving).length - MAX_KEPT;
  if (excess <= 0) return list;
  return list.filter((toast) => {
    if (toast.leaving || excess <= 0) return true;
    excess--;
    return false;
  });
}

/** Resting offset of the toast `index` places behind the front one. */
function restingY(index: number, expanded: boolean) {
  return expanded ? -index * 66 : -index * 11;
}

function toastStyle(toast: ToastItem, index: number, expanded: boolean, reduced: boolean): React.CSSProperties {
  if (toast.leaving) {
    const { how, x, y, z } = toast.leaving;
    if (how === "away") {
      return {
        transform: `translate3d(${x}px, ${y}px, 0)`,
        opacity: 0,
        zIndex: z,
        pointerEvents: "none",
        transition: reduced ? undefined : "transform .3s cubic-bezier(.3,.6,.4,1), opacity .25s",
      };
    }
    return { transform: `translate3d(0, ${y + 30}px, 0) scale(.9)`, opacity: 0, zIndex: z, pointerEvents: "none" };
  }
  const visible = index < MAX_VISIBLE;
  const layout = { zIndex: 100 - index, pointerEvents: visible ? "auto" : "none" } as const;
  if (toast.entering) return { ...layout, transform: "translate3d(0, 76px, 0) scale(.94)", opacity: 0 };
  if (toast.dragging) {
    return {
      ...layout,
      transform: `translate3d(${toast.dx}px, ${toast.dragY}px, 0)`,
      opacity: 1 - Math.min(0.8, Math.abs(toast.dx) / 260),
    };
  }
  const scale = expanded ? 1 : 1 - index * 0.055;
  return {
    ...layout,
    transform: `translate3d(${toast.dx}px, ${restingY(index, expanded)}px, 0) scale(${scale})`,
    opacity: visible ? 1 : 0,
  };
}

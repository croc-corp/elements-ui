"use client";

import * as React from "react";

import { prefersReducedMotion, useReducedMotion } from "@/lib/lumesec/motion";
import { BurstLayer, useBurst } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Imperative actions on the send button, exposed through `ref`. */
export interface UiSendButtonHandle {
  /** Switch to the running state and call `onSend`. Ignored while running. */
  send(): void;
  /** Return to idle and call `onStop`. Ignored when idle or while the ring is closing. */
  stop(): void;
  /**
   * Close the ring, burst sparks, return to idle and call `onComplete` about 380 ms later. Ignored when
   * idle or already completing.
   */
  complete(): void;
}

export interface UiSendButtonProps extends Omit<React.ComponentProps<"button">, "ref" | "children"> {
  /** Controlled running state. Use with `onRunningChange`. */
  running?: boolean;
  /** Initial running state when uncontrolled. */
  defaultRunning?: boolean;
  /** Called when a send, stop or completion changes the running state. */
  onRunningChange?: (running: boolean) => void;
  /**
   * Seconds after which a send completes on its own, for demos. `0` means the button waits for
   * `complete()` or a stop. Read on each send.
   */
  demoDuration?: number;
  /** Called when the idle button is pressed or `send()` is called. */
  onSend?: () => void;
  /** Called when a running send is stopped with the button or `stop()`. */
  onStop?: () => void;
  /** Called when a running send completes, after the ring has closed. */
  onComplete?: () => void;
  /** Exposes `send()`, `stop()` and `complete()`. */
  ref?: React.Ref<UiSendButtonHandle>;
  /** The accessible name while idle. Default `"Send"`. */
  sendLabel?: string;
  /** The accessible name while running. Default `"Stop"`. */
  stopLabel?: string;
}

type RingPhase = "idle" | "complete" | "fade";

/**
 * Round send button that turns into a stop button with an orbiting ring while a reply streams, then
 * closes the ring with sparks on completion. The button does not stream anything itself: call
 * `complete()` through `ref` when the reply finishes.
 *
 * @example
 * const button = React.useRef<UiSendButtonHandle>(null);
 * <UiSendButton ref={button} onSend={() => stream().then(() => button.current?.complete())} />
 */
export function UiSendButton({
  running: runningProp,
  defaultRunning = false,
  onRunningChange,
  demoDuration = 0,
  onSend,
  onStop,
  onComplete,
  ref,
  sendLabel = "Send",
  stopLabel = "Stop",
  className,
  onClick,
  ...props
}: UiSendButtonProps) {
  const [running, setRunning] = useControllableState({
    value: runningProp,
    defaultValue: defaultRunning,
    onChange: onRunningChange,
  });
  const [ring, setRing] = React.useState<RingPhase>("idle");
  const reduced = useReducedMotion();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const arrowRef = React.useRef<HTMLSpanElement>(null);
  const stopRef = React.useRef<HTMLSpanElement>(null);
  const ringRef = React.useRef<SVGSVGElement>(null);
  const { ref: sparksRef, fire: fireSparks } = useBurst();

  const runningNow = React.useRef(running);
  const completing = React.useRef(false);
  const timers = React.useRef({ demo: 0, close: 0, reset: 0 });
  const latest = React.useRef({ demoDuration, onSend, onStop, onComplete });
  React.useEffect(() => {
    runningNow.current = running;
    latest.current = { demoDuration, onSend, onStop, onComplete };
  });

  const actions = React.useMemo<UiSendButtonHandle>(() => {
    const update = (next: boolean) => {
      runningNow.current = next;
      setRunning(next);
    };
    const complete = () => {
      if (!runningNow.current || completing.current) return;
      window.clearTimeout(timers.current.demo);
      // a previous completion's fade must not reset the ring halfway through this one
      window.clearTimeout(timers.current.reset);
      completing.current = true;
      setRing("complete");
      timers.current.close = window.setTimeout(() => {
        completing.current = false;
        setRing("fade");
        if (buttonRef.current) fireSparks(buttonRef.current, { count: 26, speed: [60, 210] });
        update(false);
        latest.current.onComplete?.();
        timers.current.reset = window.setTimeout(() => setRing("idle"), 320);
      }, 380);
    };
    return {
      send() {
        if (runningNow.current) return;
        update(true);
        latest.current.onSend?.();
        window.clearTimeout(timers.current.demo);
        const seconds = latest.current.demoDuration;
        if (seconds > 0) timers.current.demo = window.setTimeout(complete, seconds * 1000);
      },
      // a stop while the ring closes would report both outcomes, so it is ignored
      stop() {
        if (!runningNow.current || completing.current) return;
        window.clearTimeout(timers.current.demo);
        update(false);
        latest.current.onStop?.();
      },
      complete,
    };
  }, [setRunning, fireSparks]);

  React.useImperativeHandle(ref, () => actions, [actions]);

  // icons swap with a small choreography whenever the state flips, from a click or from outside
  const previous = React.useRef(running);
  React.useLayoutEffect(() => {
    if (previous.current === running) return;
    previous.current = running;
    if (!running) {
      window.clearTimeout(timers.current.demo);
      if (completing.current) {
        // stopped from outside while the ring was closing: drop the completion
        completing.current = false;
        window.clearTimeout(timers.current.close);
        setRing("idle");
      }
    }
    if (prefersReducedMotion()) return;
    if (running) animateIn(arrowRef.current, stopRef.current);
    else animateOut(arrowRef.current, stopRef.current);
  }, [running]);

  // the orbiting arc: 1.1 s per turn until the ring closes
  React.useEffect(() => {
    // the whole svg turns, which the compositor runs; turning the circle inside it repaints on every frame
    const ringSvg = ringRef.current;
    if (!running || ring !== "idle" || reduced || !ringSvg) return;
    const spin = ringSvg.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: 1100,
      iterations: Infinity,
    });
    return () => spin.cancel();
  }, [running, ring, reduced]);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.demo);
      window.clearTimeout(pending.close);
      window.clearTimeout(pending.reset);
    };
  }, []);

  const state = running ? "running" : "idle";
  const ringVisible = (running || ring === "complete") && ring !== "fade";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-slot="ui-send-button"
      data-state={state}
      aria-label={running ? stopLabel : sendLabel}
      className={cn(
        "group relative grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-lumesec p-0 font-[inherit] text-lumesec-foreground outline-none select-none",
        "[transition:background-color_.35s_ease,color_.35s_ease,transform_.2s_cubic-bezier(.2,.8,.2,1),box-shadow_.35s] active:[transform:scale(.9)] disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
        "data-[state=running]:bg-muted data-[state=running]:text-foreground data-[state=running]:shadow-[inset_0_0_0_1px_var(--border)]",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (runningNow.current) actions.stop();
        else actions.send();
      }}
      {...props}
    >
      <span
        ref={arrowRef}
        className="col-start-1 row-start-1 grid place-items-center group-data-[state=running]:opacity-0"
      >
        <svg
          viewBox="0 0 18 18"
          aria-hidden="true"
          className="size-[18px] fill-none stroke-current [stroke-width:2.2] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <path d="M9 14.5V3.8M4.3 8.3L9 3.6l4.7 4.7" />
        </svg>
      </span>
      <span
        ref={stopRef}
        className="col-start-1 row-start-1 grid [transform:scale(0)] place-items-center opacity-0 group-data-[state=running]:[transform:none] group-data-[state=running]:opacity-100"
      >
        <span className="block size-3 rounded-[3px] bg-current" />
      </span>
      <svg
        ref={ringRef}
        viewBox="0 0 48 48"
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-1 -left-1 size-12 overflow-visible [transition:opacity_.3s]",
          ringVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <circle
          cx="24"
          cy="24"
          r="22"
          className={cn(
            "origin-[24px_24px] fill-none stroke-lumesec [stroke-width:2.2] [stroke-dasharray:34_105] [stroke-linecap:round]",
            ring !== "idle" && "[stroke-dasharray:139_0] [transition:stroke-dasharray_.35s_cubic-bezier(.3,.7,.3,1)]",
          )}
        />
      </svg>
      <BurstLayer ref={sparksRef} />
    </button>
  );
}

function animateIn(arrow: HTMLElement | null, stop: HTMLElement | null) {
  arrow?.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-16px)", opacity: 0 },
    ],
    { duration: 220, easing: "cubic-bezier(.5,0,.75,0)" },
  );
  stop?.animate(
    [
      { transform: "scale(0) rotate(-90deg)", opacity: 0 },
      { transform: "scale(1.2) rotate(8deg)", opacity: 1, offset: 0.6 },
      { transform: "scale(1) rotate(0deg)", opacity: 1 },
    ],
    { duration: 380, delay: 90, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
  );
}

function animateOut(arrow: HTMLElement | null, stop: HTMLElement | null) {
  stop?.animate(
    [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(0)", opacity: 0 },
    ],
    { duration: 180, easing: "ease-in" },
  );
  arrow?.animate(
    [
      { transform: "translateY(16px)", opacity: 0 },
      { transform: "translateY(-3px)", opacity: 1, offset: 0.6 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 420, delay: 100, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
  );
}

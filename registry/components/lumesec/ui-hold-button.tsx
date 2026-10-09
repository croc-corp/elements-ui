"use client";

import * as React from "react";

import { useCanvas } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import { hash, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion, useAnimationLoop } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { BurstLayer, useBurst } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

export interface UiHoldButtonProps extends Omit<React.ComponentProps<"button">, "children"> {
  /** Hold time in milliseconds needed to confirm. */
  duration?: number;
  /** Idle label. */
  label?: string;
  /** Label shown after confirming. */
  doneLabel?: string;
  /** Called once the button has been held for `duration`. */
  onConfirm?: () => void;
}

type HoldPhase = "idle" | "hold" | "done";
type LabelKind = "idle" | "keep" | "done";

interface HoldState {
  /** Fill, 0 to 1. */
  progress: number;
  /** Confirm flash, 1 fading to 0. */
  flash: number;
  /** Whether a pointer or key is down. */
  holding: boolean;
  phase: HoldPhase;
}

const KEEP_LABEL = "Keep holding";

/**
 * Hold-to-confirm button for destructive actions: holding fills it as the bin lid lifts; letting go early
 * drains it with a shake. A single click or key press does nothing; Space and Enter work when held.
 *
 * @example
 * <UiHoldButton label="Hold to delete" onConfirm={() => deleteProject()} />
 */
export function UiHoldButton({
  duration = 1200,
  label = "Hold to delete",
  doneLabel = "Deleted",
  onConfirm,
  disabled,
  ref,
  className,
  onClick,
  onKeyDown,
  onKeyUp,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onBlur,
  ...props
}: UiHoldButtonProps) {
  const [labelState, setLabelState] = React.useState<{ kind: LabelKind; direction: number }>({
    kind: "idle",
    direction: 1,
  });
  const [done, setDone] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const lidRef = React.useRef<SVGGElement>(null);
  const { ref: sparksRef, fire: fireSparks } = useBurst();
  // the animation loop needs the button too, so the caller's ref receives it through a handle
  React.useImperativeHandle(ref, () => buttonRef.current!, []);

  // hold progress, the confirm flash and the phase live outside React state: they change every frame
  const hold = React.useRef<HoldState>({ progress: 0, flash: 0, holding: false, phase: "idle" });
  const timers = React.useRef({ label: 0, reset: 0 });
  const latest = React.useRef({ duration, onConfirm });
  React.useEffect(() => {
    latest.current = { duration, onConfirm };
  });

  const surface = useCanvas(canvasRef, () => draw(performance.now()));
  const palette = usePalette(canvasRef);
  const loop = useAnimationLoop(buttonRef, step);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      window.clearTimeout(pending.label);
      window.clearTimeout(pending.reset);
    };
  }, []);

  // disabling the button mid-hold drains the fill; a disabled button may never see the pointer or key release
  React.useEffect(() => {
    const state = hold.current;
    if (!disabled || !state.holding) return;
    state.holding = false;
    state.phase = "idle";
    loop.kick();
  }, [disabled, loop]);

  function draw(now: number) {
    const canvas = surface.current;
    const colors = palette.current;
    if (!canvas || !colors) return;
    const { context, width, height } = canvas;
    const { progress, flash } = hold.current;
    const x = progress * width;
    context.clearRect(0, 0, width, height);
    if (progress <= 0) return;
    const color = colors.destructive;
    context.fillStyle = rgba(color, 0.15 + 0.25 * flash);
    context.fillRect(0, 0, Math.max(0, x - 9), height);
    // dithered, crawling leading edge
    const tick = Math.floor(now / 70);
    for (let cx = Math.max(0, Math.floor((x - 9) / 3) * 3); cx < Math.min(width, x + 9); cx += 3) {
      const density = 1 - (cx - (x - 9)) / 18;
      for (let cy = 0; cy < height; cy += 3) {
        if (hash(cx * 7.1 + cy * 13.3 + tick * 0.37) < density) {
          context.fillStyle = rgba(color, 0.18 + 0.45 * (1 - density));
          context.fillRect(cx, cy, 2, 2);
        }
      }
    }
  }

  function step(time: number, delta: number) {
    const state = hold.current;
    if (state.phase === "hold" && state.holding) {
      state.progress = Math.min(1, state.progress + (delta * 1000) / latest.current.duration);
      if (state.progress >= 1) complete();
    } else if (state.phase !== "done") {
      state.progress = Math.max(0, state.progress - delta * 3.2);
    }
    state.flash = Math.max(0, state.flash - delta * 2.2);
    if (lidRef.current) {
      lidRef.current.style.transform = `rotate(${-state.progress * 30}deg) translateY(${-state.progress * 1.2}px)`;
    }
    if (buttonRef.current) {
      buttonRef.current.style.scale = state.phase === "done" ? "" : String(1 - state.progress * 0.035);
    }
    draw(time * 1000);
    return state.holding || (state.progress > 0 && state.phase !== "done") || state.flash > 0;
  }

  const start = () => {
    const state = hold.current;
    // some browsers still deliver pointer events to a disabled button
    if (disabled || state.phase === "done") return;
    state.holding = true;
    state.phase = "hold";
    loop.kick();
  };

  const end = () => {
    const state = hold.current;
    if (!state.holding) return;
    state.holding = false;
    if (state.phase === "done") return;
    state.phase = "idle";
    if (state.progress > 0.04) nudge();
    loop.kick();
  };

  /** Let go too early: shake and ask to keep holding for 1.3 s. */
  const nudge = () => {
    if (!prefersReducedMotion()) {
      buttonRef.current?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(-3px)" },
          { transform: "translateX(2px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 380, easing: "ease-out" },
      );
    }
    setLabelState({ kind: "keep", direction: 1 });
    window.clearTimeout(timers.current.label);
    timers.current.label = window.setTimeout(() => {
      if (hold.current.phase !== "done") setLabelState({ kind: "idle", direction: -1 });
    }, 1300);
  };

  function complete() {
    const state = hold.current;
    state.phase = "done";
    state.holding = false;
    state.flash = 1;
    state.progress = 1;
    setDone(true);
    window.clearTimeout(timers.current.label);
    setLabelState({ kind: "done", direction: 1 });
    if (buttonRef.current) {
      fireSparks(buttonRef.current, {
        count: 34,
        colors: ["--destructive", "--lumesec-glint"],
        speed: [70, 230],
        jitter: 30,
        life: [0.35, 0.8],
      });
    }
    latest.current.onConfirm?.();
    window.clearTimeout(timers.current.reset);
    // the done state holds for 2.2 s and ignores presses, then the button resets
    timers.current.reset = window.setTimeout(() => {
      hold.current.phase = "idle";
      setDone(false);
      setLabelState({ kind: "idle", direction: -1 });
      loop.kick();
    }, 2200);
  }

  const text = labelState.kind === "done" ? doneLabel : labelState.kind === "keep" ? KEEP_LABEL : label;

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      data-slot="ui-hold-button"
      data-state={done ? "done" : "idle"}
      className={cn(
        "relative inline-flex h-[38px] cursor-pointer touch-none items-center rounded-[10px] border border-[color-mix(in_srgb,var(--destructive)_38%,var(--border))] bg-card pr-4 pl-[13px] font-[inherit] text-[13.5px] leading-normal font-medium text-destructive outline-none select-none disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
        className,
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event);
        end();
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        end();
      }}
      onLostPointerCapture={(event) => {
        onLostPointerCapture?.(event);
        end();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        onKeyUp?.(event);
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          end();
        }
      }}
      onBlur={(event) => {
        onBlur?.(event);
        // a key hold ends when focus leaves (Tab, another window), or the fill would run on and confirm
        end();
      }}
      onClick={(event) => {
        onClick?.(event);
        // a plain click must never confirm
        event.preventDefault();
      }}
      {...props}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[9px]">
        <canvas ref={canvasRef} aria-hidden="true" className="block size-full" />
      </span>
      <span className="pointer-events-none relative flex items-center gap-2">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-4 overflow-visible fill-none stroke-current [stroke-width:1.6] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          <g ref={lidRef} className="origin-[13.5px_4px] [transform-box:view-box]">
            <path d="M2.5 4h11" />
            <path d="M6 4V2.6h4V4" />
          </g>
          <path d="M3.8 4l.7 9.2c.1.8.7 1.3 1.5 1.3h4c.8 0 1.4-.5 1.5-1.3L12.2 4" />
        </svg>
        <RollText
          text={text}
          direction={labelState.direction}
          reserve={[label, doneLabel, KEEP_LABEL]}
          aria-live="polite"
        />
      </span>
      <BurstLayer ref={sparksRef} />
    </button>
  );
}

"use client";

import * as React from "react";

import { parseColor } from "@/lib/lumesec/color";
import type { RGB } from "@/lib/lumesec/math";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { RollText } from "@/lib/lumesec/roll-text";
import { BurstLayer, useBurst } from "@/lib/lumesec/sparks";
import { cn } from "@/lib/utils";

/** `armed` waits for the second click while the fuse burns; `done` shows the done text for 2 s. */
export type PxConfirmState = "idle" | "armed" | "done";

/** Props of `PxConfirm`. Other `span` props go to the wrapper around the button. */
export interface PxConfirmProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Idle label. */
  children?: string;
  /** Seconds the armed state lasts before it cancels. */
  timeout?: number;
  /** Label while armed. */
  confirmText?: string;
  /** Label shown for 2 s after confirming. */
  doneText?: string;
  /** Called on the second click inside the window. */
  onConfirm?: () => void;
  /** Called when the armed state ends without confirming: Escape, the button losing focus, or the timeout. */
  onCancel?: () => void;
}

/** Ink for the fuse before the button is mounted. */
const FALLBACK_INK: RGB = [255, 255, 255];

/**
 * Two-step delete button. The first click arms it and a pixel fuse burns down along its bottom edge; a
 * second click inside `timeout` seconds confirms with a burst of sparks. Escape, blur or the fuse running
 * out cancels.
 *
 * @example
 * <PxConfirm doneText="Project deleted" onConfirm={() => deleteProject()}>Delete project</PxConfirm>
 */
export function PxConfirm({
  children = "Delete project",
  timeout = 3,
  confirmText = "Click again to confirm",
  doneText = "Deleted",
  onConfirm,
  onCancel,
  className,
  ...props
}: PxConfirmProps) {
  const [state, setState] = React.useState<PxConfirmState>("idle");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const { ref: sparksRef, fire: fireSparks } = useBurst();
  const armedAt = React.useRef(0);
  const doneTimer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(doneTimer.current), []);

  const callbacks = React.useRef({ onConfirm, onCancel });
  React.useEffect(() => {
    callbacks.current = { onConfirm, onCancel };
  });

  const arm = () => {
    armedAt.current = performance.now() / 1000;
    setState("armed");
  };

  const disarm = React.useCallback(() => {
    setState("idle");
    callbacks.current.onCancel?.();
  }, []);

  // the window closes on a timer, not in the fuse's animation loop, which pauses off screen and in hidden tabs
  React.useEffect(() => {
    if (state !== "armed") return;
    const remaining = (armedAt.current + timeout) * 1000 - performance.now();
    const timer = window.setTimeout(disarm, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [state, timeout, disarm]);

  const confirm = () => {
    setState("done");
    if (buttonRef.current) {
      fireSparks(buttonRef.current, {
        count: 36,
        colors: ["--destructive", "--lumesec-shine"],
        speed: [70, 230],
        life: [0.35, 0.85],
        jitter: 30,
      });
    }
    callbacks.current.onConfirm?.();
    window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => setState("idle"), 2000);
  };

  const { ref: canvasRef, redraw } = usePixelCanvas(({ time, width, clear, dot }) => {
    clear();
    if (state !== "armed") return false;
    const left = 1 - (time - armedAt.current) / timeout;
    if (left <= 0) return false;
    // the fuse burns in the label's colour
    const ink = buttonRef.current ? parseColor(getComputedStyle(buttonRef.current).color) : FALLBACK_INK;
    for (let x = 0; x < width * left; x += 3) dot(x, 1, ink, 0.85, 2);
    return true;
  });

  React.useEffect(redraw, [state, redraw]);

  const label = state === "armed" ? confirmText : state === "done" ? doneText : children;

  return (
    <span
      data-slot="px-confirm"
      data-state={state === "idle" ? undefined : state}
      className={cn("relative inline-block align-middle", className)}
      {...props}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (state === "armed") confirm();
          else if (state === "idle") arm();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && state === "armed") disarm();
        }}
        onBlur={() => {
          if (state === "armed") disarm();
        }}
        className={cn(
          "relative inline-flex h-10 cursor-pointer items-center overflow-hidden rounded-[10px] border border-[color-mix(in_srgb,var(--destructive)_40%,var(--border))] bg-card px-4 font-[inherit] text-[14px] font-semibold text-destructive select-none",
          "[transition:background-color_.2s,color_.2s,transform_.15s_cubic-bezier(.2,.8,.2,1)] active:[transform:scale(.96)]",
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid",
          state === "armed" && "border-transparent bg-destructive text-lumesec-foreground",
          state === "done" && "border-border bg-card text-muted-foreground",
        )}
      >
        <RollText
          text={label}
          direction={state === "idle" ? -1 : 1}
          aria-live="polite"
          className="justify-items-center"
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 block h-1 w-full [image-rendering:pixelated]"
        />
      </button>
      <BurstLayer ref={sparksRef} />
    </span>
  );
}

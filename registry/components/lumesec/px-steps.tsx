"use client";

import * as React from "react";

import { clamp, TAU } from "@/lib/lumesec/math";
import { prefersReducedMotion, useLazyRef } from "@/lib/lumesec/motion";
import { usePixelCanvas } from "@/lib/lumesec/pixel-canvas";
import { SMALL_CHECK } from "@/lib/lumesec/pixel-font";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Props of `PxSteps`. Other `div` props go to the root element. */
export interface PxStepsProps extends Omit<React.ComponentProps<"div">, "children" | "onChange"> {
  /** Step names, in order. */
  steps?: readonly string[];
  /** Controlled current step, from 1. One more than the number of steps marks the flow complete. */
  step?: number;
  /** Initial step when uncontrolled. */
  defaultStep?: number;
  /** Called with the new step when the user moves: Back, Continue, Finish or a click on a finished step. */
  onStepChange?: (step: number) => void;
  /** Called when the user moves past the last step. */
  onComplete?: () => void;
  /** Shows Back and Continue buttons; Continue reads Finish on the last step. */
  controls?: boolean;
}

const DEFAULT_STEPS = ["Details", "Billing", "Review", "Done"];

/** Vertical centre of the nodes on the canvas. */
const NODE_Y = 18;

/**
 * Wizard progress with numbered pixel rings joined by lines that fill as you advance. Finished steps show
 * a check and lead back on click; finishing the flow throws sparks from every node.
 *
 * @example
 * <PxSteps steps={["Details", "Billing", "Review", "Done"]} defaultStep={2} controls />
 */
export function PxSteps({
  steps = DEFAULT_STEPS,
  step: stepProp,
  defaultStep = 1,
  onStepChange,
  onComplete,
  controls = false,
  className,
  ...props
}: PxStepsProps) {
  const count = steps.length;
  const [rawStep, setStep] = useControllableState({ value: stepProp, defaultValue: defaultStep, onChange: onStepChange });
  const current = clamp(Math.round(rawStep), 1, count + 1);

  /** The drawn progress, easing toward `current - 1`. */
  const progress = React.useRef(current - 1);
  const sparksRef = useLazyRef(() => new Sparks());
  const burstPending = React.useRef(false);
  const shownStep = React.useRef(current);
  /** The numbers over the nodes; the draw loop hides each one when its check appears. */
  const numberRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  // React sets the first visibility only; after that the loop owns it, in step with the drawn progress
  const [initialStep] = React.useState(current);

  const { ref: canvasRef, redraw } = usePixelCanvas((frame) => {
    const { palette, time, delta, width, context } = frame;
    const reduced = prefersReducedMotion();
    const target = current - 1;
    const nodeX = (i: number) => ((i + 0.5) * width) / count;
    if (burstPending.current) {
      burstPending.current = false;
      for (let i = 0; i < count; i++) sparksRef.current.add(nodeX(i), NODE_Y, 10, [palette.success, palette.shine], { speed: [30, 120] });
    }
    progress.current = reduced ? target : progress.current + clamp(target - progress.current, -delta * 2.5, delta * 2.5);
    const f = progress.current;
    frame.clear();

    for (let i = 0; i < count - 1; i++) {
      const x0 = nodeX(i) + 18;
      const x1 = nodeX(i + 1) - 18;
      const fill = clamp(f - i, 0, 1);
      for (let x = x0; x < x1; x += 4) {
        const on = (x - x0) / (x1 - x0) < fill;
        frame.dot(x - 1.2, NODE_Y - 1.2, on ? palette.accent : palette.foreground, on ? 0.95 : 0.18, 2.4);
      }
    }

    for (let i = 0; i < count; i++) {
      const x = nodeX(i);
      const done = i < Math.floor(f + 0.001) && i < current - 1;
      const isCurrent = i === current - 1;
      const r = 12;
      const color = done || isCurrent ? palette.accent : palette.foreground;
      for (let k = 0; k < 28; k++) {
        const a = (TAU * k) / 28;
        frame.dot(x + Math.cos(a) * r - 1.1, NODE_Y + Math.sin(a) * r - 1.1, color, done || isCurrent ? 0.95 : 0.25, 2.2);
      }
      if (done) {
        for (let yy = -9; yy <= 9; yy += 3) {
          for (let xx = -9; xx <= 9; xx += 3) if (Math.hypot(xx, yy) < 9.5) frame.dot(x + xx - 1.2, NODE_Y + yy - 1.2, palette.accent, 1, 2.4);
        }
        for (const [px, py] of SMALL_CHECK) frame.dot(x - 7 + px * 2, NODE_Y - 5 + py * 2, palette.card, 1, 2);
      }
      // the number is text over the node; it gives way to the check when the line reaches the node
      const number = numberRefs.current[i];
      if (number) number.style.opacity = done ? "0" : "1";
      if (isCurrent && !reduced) {
        const k = (time * 0.9) % 1;
        const ring = r + 2 + k * 8;
        for (let a = 0; a < TAU; a += TAU / 24) frame.dot(x + Math.cos(a) * ring - 1, NODE_Y + Math.sin(a) * ring - 1, palette.accent, (1 - k) * 0.5, 2);
      }
    }

    const sparking = sparksRef.current.step(context, delta);
    // the current step pulses for as long as the steps are on screen
    return !reduced || Math.abs(f - target) > 0.001 || sparking;
  });

  React.useEffect(() => {
    const previous = shownStep.current;
    shownStep.current = current;
    if (previous !== current && current > count) burstPending.current = true;
    redraw();
  }, [current, count, redraw]);

  const backRef = React.useRef<HTMLButtonElement>(null);
  const continueRef = React.useRef<HTMLButtonElement>(null);

  const goTo = (next: number) => {
    setStep(next);
    if (next > count) onComplete?.();
  };

  return (
    <div data-slot="px-steps" className={cn("block text-foreground", className)} {...props}>
      <div className="relative">
        <canvas ref={canvasRef} aria-hidden="true" className="block h-11 w-full [image-rendering:pixelated]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 grid h-9" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
          {steps.map((name, i) => (
            <span
              key={`${i}:${name}`}
              ref={(node) => {
                numberRefs.current[i] = node;
              }}
              className={cn(
                "grid place-items-center font-mono text-[12px] leading-none font-semibold text-muted-foreground tabular-nums transition-[opacity,color] duration-150",
                i + 1 === current && "text-foreground",
              )}
              style={{ opacity: i + 1 < initialStep ? 0 : 1 }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      </div>
      <ol className="m-0 mt-1.5 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
        {steps.map((name, i) => {
          const done = i + 1 < current;
          const isCurrent = i + 1 === current;
          return (
            <li key={`${i}:${name}`} className="text-center">
              {/* only finished steps lead back; the others stay focusable but say they cannot be activated */}
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                aria-disabled={done ? undefined : true}
                aria-label={`${name}, step ${i + 1} of ${count}${done ? ", done" : ""}`}
                className={cn(
                  "cursor-default select-none rounded-md border-0 bg-transparent px-1 py-0.5 text-[12.5px] leading-normal text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec",
                  done && "cursor-pointer text-foreground hover:text-lumesec",
                  isCurrent && "font-semibold text-foreground",
                )}
                onClick={() => {
                  if (done) goTo(i + 1);
                }}
              >
                {name}
              </button>
            </li>
          );
        })}
      </ol>
      {controls && (
        <div className="mt-3.5 flex justify-end gap-2">
          <button
            ref={backRef}
            type="button"
            className={PIXEL_BUTTON}
            disabled={current === 1}
            onClick={(event) => {
              // Back disables itself on the first step; hand its focus to Continue so it does not fall to the page
              if (current - 1 === 1 && event.currentTarget === document.activeElement) continueRef.current?.focus();
              goTo(current - 1);
            }}
          >
            Back
          </button>
          <button
            ref={continueRef}
            type="button"
            className={PIXEL_BUTTON}
            disabled={current > count}
            onClick={(event) => {
              // Finish disables itself; hand its focus to Back
              if (current + 1 > count && event.currentTarget === document.activeElement) backRef.current?.focus();
              goTo(current + 1);
            }}
          >
            {current >= count ? "Finish" : "Continue"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The small bordered button of the Pixel UI kit. */
const PIXEL_BUTTON =
  "inline-flex h-[30px] cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 font-[inherit] text-[12.5px] leading-normal font-medium text-foreground outline-none [transition:transform_.15s_cubic-bezier(.2,.8,.2,1),background-color_.2s,border-color_.2s,color_.2s] enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-lumesec enabled:active:[transform:scale(.95)] disabled:cursor-not-allowed disabled:opacity-50";

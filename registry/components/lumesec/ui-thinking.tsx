"use client";

import * as React from "react";

import { useCanvas } from "@/lib/lumesec/canvas";
import { usePalette, type ColorToken, type Palette } from "@/lib/lumesec/color";
import { mixRgb, rgba } from "@/lib/lumesec/math";
import { prefersReducedMotion, useAnimationLoop, useReducedMotion } from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** Imperative controls, for callers that do not track `done` themselves. */
export interface UiThinkingHandle {
  /** Finish: the glyph draws a check and the label rolls to "Thought for Ns". Same as setting `done`. */
  finish(): void;
  /** Reset the counter to 0 and return to the thinking state, collapsing the reasoning. */
  restart(): void;
}

export interface UiThinkingProps extends Omit<React.ComponentProps<"div">, "ref"> {
  /** Whether thinking has finished (controlled). Use with `onDoneChange`. */
  done?: boolean;
  /** Whether it starts finished, when uncontrolled. */
  defaultDone?: boolean;
  /** Called when `finish()` or `restart()` changes the state. */
  onDoneChange?: (done: boolean) => void;
  /**
   * Called when the state changes to done, with the whole seconds elapsed (at least 1). Not called when the
   * component mounts already done.
   */
  onDone?: (seconds: number) => void;
  /** The reasoning, shown in a collapsible panel once done. */
  children?: React.ReactNode;
  /** Imperative `finish()` and `restart()`. */
  ref?: React.Ref<UiThinkingHandle>;
}

/**
 * Thinking indicator: a pixel wave and a shimmering label while the model works, with a seconds counter that
 * rolls on every tick. When done, the glyph draws a check and the label rolls to "Thought for Ns", which opens
 * the reasoning. Seconds count from mount, or from `restart()`.
 *
 * @example
 * <UiThinking done={!streaming}>The reasoning text.</UiThinking>
 */
export function UiThinking({ done: doneProp, defaultDone = false, onDoneChange, onDone, children, className, ref, ...props }: UiThinkingProps) {
  const [done, setDone] = useControllableState({ value: doneProp, defaultValue: defaultDone, onChange: onDoneChange });
  const [seconds, setSeconds] = React.useState(0);
  /** Bumped by `restart()` to restart the counter. */
  const [run, setRun] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);

  // Returning to the thinking state collapses the reasoning.
  const [wasDone, setWasDone] = React.useState(done);
  if (wasDone !== done) {
    setWasDone(done);
    if (!done) setExpanded(false);
  }

  const rootRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const labelRef = React.useRef<HTMLSpanElement>(null);
  const startedAt = React.useRef(0);
  const reportedDone = React.useRef(done);

  const reducedMotion = useReducedMotion();
  const panelId = React.useId();

  const loop = useAnimationLoop(rootRef, step);
  // a resize clears the canvas, so redraw (the still frame with reduced motion would stay blank otherwise)
  const canvas = useCanvas(canvasRef, () => loop.kick());
  const colors = usePalette(rootRef, WAVE_COLORS, () => loop.kick());

  function step(time: number) {
    // once done, the canvas fades out with CSS on the last drawn frame
    if (done) return false;
    const surface = canvas.current;
    const palette = colors.current;
    if (!surface || !palette) return true;
    const reduced = prefersReducedMotion();
    drawWave(surface.context, palette, time, reduced);
    // the label shimmer rides the same clock
    const label = labelRef.current;
    if (reduced) label?.style.removeProperty("--thinking-shimmer");
    else label?.style.setProperty("--thinking-shimmer", `${100 - ((time / 1.9) % 1) * 100}%`);
    // with reduced motion the wave is a still frame: draw it once and let the loop sleep
    return !reduced;
  }

  // a change of the motion preference wakes the loop, to restart the wave or draw the still frame
  React.useEffect(() => {
    loop.kick();
  }, [reducedMotion, loop]);

  React.useEffect(() => {
    startedAt.current = performance.now();
  }, []);

  // The counter runs on a timer, so it stays right while the wave is paused off screen.
  React.useEffect(() => {
    if (done) return;
    let timer = 0;
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - startedAt.current);
      setSeconds(Math.floor(elapsed / 1000));
      // wake just after the next whole second
      timer = window.setTimeout(tick, 1000 - (elapsed % 1000));
    };
    timer = window.setTimeout(tick, 0);
    loop.kick();
    return () => window.clearTimeout(timer);
  }, [done, run, loop]);

  React.useEffect(() => {
    if (reportedDone.current === done) return;
    reportedDone.current = done;
    if (done) onDone?.(Math.max(1, seconds));
  }, [done, seconds, onDone]);

  React.useImperativeHandle(
    ref,
    () => ({
      finish: () => setDone(true),
      restart: () => {
        startedAt.current = performance.now();
        setSeconds(0);
        setRun((value) => value + 1);
        setDone(false);
      },
    }),
    [setDone],
  );

  return (
    <div
      ref={rootRef}
      data-slot="ui-thinking"
      data-state={done ? "done" : "thinking"}
      className={cn("group/thinking block text-[14px] text-foreground [-webkit-tap-highlight-color:transparent]", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative h-3.5 w-5 flex-none">
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 block size-full [transition:opacity_.3s_ease,transform_.45s_cubic-bezier(.2,.8,.2,1)] group-data-[state=done]/thinking:opacity-0 group-data-[state=done]/thinking:[transform:scale(.3)]"
          />
          <svg
            viewBox="0 0 18 18"
            aria-hidden="true"
            className="absolute -top-0.5 left-px size-[18px] fill-none stroke-lumesec stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path
              d="M4 9.5l3.2 3.2L14 5.5"
              className="[stroke-dasharray:16] [stroke-dashoffset:16] [transition:stroke-dashoffset_.45s_cubic-bezier(.3,.7,.3,1)_.12s] group-data-[state=done]/thinking:[stroke-dashoffset:0]"
            />
          </svg>
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          disabled={!done}
          onClick={() => setExpanded((open) => !open)}
          className="-mx-1.5 -my-1 flex cursor-default items-center gap-2 rounded-lg border-0 bg-transparent px-1.5 py-1 text-inherit select-none [font:inherit] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec enabled:cursor-pointer enabled:hover:bg-foreground/7"
        >
          <RollText
            ref={labelRef}
            text={done ? `Thought for ${Math.max(1, seconds)}s` : "Thinking"}
            direction={done ? 1 : -1}
            className={cn("*:font-medium", !done && SHIMMER_CLASSES)}
          />
          <RollText
            text={`${seconds}s`}
            animate={seconds > 0}
            className="font-mono text-[12px] text-muted-foreground tabular-nums group-data-[state=done]/thinking:hidden"
          />
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              "size-3 fill-none stroke-muted-foreground opacity-0 [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] [transition:transform_.35s_cubic-bezier(.2,.8,.2,1),opacity_.3s] group-data-[state=done]/thinking:opacity-100",
              expanded && "[transform:rotate(90deg)]",
            )}
          >
            <path d="M4.5 2.5L8 6l-3.5 3.5" />
          </svg>
        </button>
      </div>
      <div
        id={panelId}
        data-state={expanded ? "open" : "closed"}
        // collapsed reasoning is out of the reading and tab order, not just invisible
        inert={!expanded}
        className="grid grid-rows-[0fr] opacity-0 [transition:grid-template-rows_.4s_cubic-bezier(.2,.8,.2,1),opacity_.3s] data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100"
      >
        <div className="overflow-hidden">
          <div className="mt-2.5 mb-0.5 ml-[9px] border-l-2 border-muted pl-[18px] text-[13px] leading-[1.55] text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

const WAVE_COLORS = {
  accent: ["--lumesec", "#6219f3"],
  glint: ["--lumesec-glint", "#c9bdff"],
} as const satisfies Record<string, ColorToken>;

/**
 * The thinking label: a light band sweeps across the muted text. Applied to each rolling item; the loop moves
 * `--thinking-shimmer` from 100% to 0% every 1.9 s.
 */
const SHIMMER_CLASSES =
  "*:bg-[linear-gradient(100deg,var(--muted-foreground)_0%,var(--muted-foreground)_38%,var(--foreground)_50%,var(--muted-foreground)_62%,var(--muted-foreground)_100%)] *:bg-clip-text *:text-transparent *:[background-position:var(--thinking-shimmer,0%)_0] *:[background-size:260%_100%]";

/** A 6 x 4 grid of 2px pixels; a sine wave runs through it and brightens toward the glint. */
function drawWave(context: CanvasRenderingContext2D, colors: Palette<keyof typeof WAVE_COLORS>, time: number, reduced: boolean) {
  context.clearRect(0, 0, 20, 14);
  for (let column = 0; column < 6; column++) {
    for (let row = 0; row < 4; row++) {
      const wave = reduced ? 0.55 : Math.max(0, Math.sin(time * 5.5 - column * 0.85 + row * 0.55));
      const k = wave * wave;
      context.globalAlpha = 0.18 + 0.82 * k;
      context.fillStyle = rgba(mixRgb(colors.accent, colors.glint, k * 0.7));
      context.fillRect(1 + column * 3.2, 1 + row * 3.2, 2, 2);
    }
  }
  context.globalAlpha = 1;
}

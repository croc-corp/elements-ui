"use client";

import * as React from "react";

import { useCanvas } from "@/lib/lumesec/canvas";
import { type ColorToken, type Palette, usePalette } from "@/lib/lumesec/color";
import { mixRgb, rgba } from "@/lib/lumesec/math";
import { useInView, useReducedMotion } from "@/lib/lumesec/motion";
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
  /** The visible copy, for translation. Missing entries use the English defaults. */
  labels?: Partial<UiThinkingLabels>;
}

/** The copy of the indicator. Each function receives the whole seconds shown. */
export interface UiThinkingLabels {
  /** The label while the model thinks. */
  thinking: string;
  /** The label once done, for example "Thought for 4s". */
  done: (seconds: number) => string;
  /** The running counter beside the label, for example "4s". */
  counter: (seconds: number) => string;
}

/**
 * Thinking indicator: a pixel wave and a shimmering label while the model works, with a seconds counter that
 * rolls on every tick. When done, the glyph draws a check and the label rolls to "Thought for Ns", which opens
 * the reasoning. Seconds count from mount, or from `restart()`.
 *
 * @example
 * <UiThinking done={!streaming}>The reasoning text.</UiThinking>
 */
export function UiThinking({
  done: doneProp,
  defaultDone = false,
  onDoneChange,
  onDone,
  children,
  className,
  ref,
  labels: labelsProp,
  ...props
}: UiThinkingProps) {
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const [done, setDone] = useControllableState({
    value: doneProp,
    defaultValue: defaultDone,
    onChange: onDoneChange,
  });
  const [seconds, setSeconds] = React.useState(0);
  /** Bumped by `restart()` to restart the counter. */
  const [run, setRun] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);

  // An indicator that mounts done never shows the wave, so its canvas holds a single frame. The strip
  // appears with the first thinking state and stays, so the wave can fade out on the frame it stopped at.
  const [strip, setStrip] = React.useState(!done);
  if (!done && !strip) setStrip(true);

  // Returning to the thinking state collapses the reasoning.
  const [wasDone, setWasDone] = React.useState(done);
  if (wasDone !== done) {
    setWasDone(done);
    if (!done) setExpanded(false);
  }

  const rootRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const bandRef = React.useRef<HTMLSpanElement>(null);
  const bandTextRef = React.useRef<HTMLSpanElement>(null);
  const animations = React.useRef<Animation[]>([]);
  const startedAt = React.useRef(0);
  const reportedDone = React.useRef(done);

  const reducedMotion = useReducedMotion();
  // the wave and the shimmer pause off screen
  const inView = useInView(rootRef);
  const panelId = React.useId();

  // The wave is drawn once into a strip of frames, and a transform animation steps through the strip on the
  // compositor, so the main thread does no work per frame. The strip is drawn again only when the canvas size, the
  // theme or the motion preference changes.
  const [paintCount, repaint] = React.useReducer((count: number) => count + 1, 0);
  const canvas = useCanvas(canvasRef, repaint, { maxDpr: 2 });
  const colors = usePalette(rootRef, WAVE_COLORS, repaint);
  // paintCount is the trigger after a resize or a theme change
  React.useEffect(() => {
    const surface = canvas.current;
    const palette = colors.current;
    if (surface && palette) drawStrip(surface.context, palette, reducedMotion, Math.round(surface.width / 20));
  }, [canvas, colors, reducedMotion, paintCount]);

  // The wave and the shimmer are transform animations, which the compositor runs without main-thread
  // work. With reduced motion there are none: the still frame and the plain label stay.
  React.useEffect(() => {
    const wave = canvasRef.current;
    const band = bandRef.current;
    const bandText = bandTextRef.current;
    if (reducedMotion || !wave || !band || !bandText || typeof wave.animate !== "function") return;
    const running = [
      wave.animate(WAVE_KEYFRAMES, {
        duration: WAVE_PERIOD * 1000,
        iterations: Number.POSITIVE_INFINITY,
        easing: `steps(${FRAMES})`,
      }),
      band.animate(BAND_KEYFRAMES, SHIMMER_TIMING),
      bandText.animate(BAND_TEXT_KEYFRAMES, SHIMMER_TIMING),
    ];
    animations.current = running;
    return () => {
      for (const animation of running) animation.cancel();
      animations.current = [];
    };
  }, [reducedMotion]);

  // done keeps the frame the wave stopped on while it fades; off screen nothing runs
  // reducedMotion is a trigger: it recreates the animations, which then need pausing or playing
  React.useEffect(() => {
    for (const animation of animations.current) {
      if (done || !inView) animation.pause();
      else animation.play();
    }
  }, [done, inView, reducedMotion]);

  React.useEffect(() => {
    startedAt.current = performance.now();
  }, []);

  // The counter runs on a timer, so it stays right while the wave is paused off screen.
  // run is a trigger: restart() starts the counter again
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
    return () => window.clearTimeout(timer);
  }, [done, run]);

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
      className={cn(
        "group/thinking block text-[14px] text-foreground [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative h-3.5 w-5 flex-none">
          <span className="absolute inset-0 overflow-hidden [transition:opacity_.3s_ease,transform_.45s_cubic-bezier(.2,.8,.2,1)] group-data-[state=done]/thinking:[transform:scale(.3)] group-data-[state=done]/thinking:opacity-0">
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="block h-3.5"
              style={{ width: `${(strip ? FRAMES : 1) * 20}px` }}
            />
          </span>
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
          className="-mx-1.5 -my-1 flex cursor-default items-center gap-2 rounded-lg border-0 bg-transparent px-1.5 py-1 text-inherit outline-none select-none [font:inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid enabled:cursor-pointer enabled:hover:bg-foreground/7"
        >
          <span className="relative inline-grid">
            <RollText
              text={done ? labels.done(Math.max(1, seconds)) : labels.thinking}
              direction={done ? 1 : -1}
              className={cn("*:font-medium", !done && "text-muted-foreground")}
            />
            {/*
              The shimmer is a copy of the label in the foreground colour, seen through a soft-edged band. The band
              and the copy move in opposite directions with transforms, so the compositor runs the sweep without a
              repaint on every frame.
            */}
            <span
              aria-hidden="true"
              hidden={done || reducedMotion}
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              <span
                ref={bandRef}
                className="absolute inset-y-0 left-0 w-[62.4%] overflow-hidden [mask-image:linear-gradient(100deg,transparent_0%,#000_50%,transparent_100%)]"
              >
                <span
                  ref={bandTextRef}
                  className="absolute top-0 left-0 w-[160.26%] font-medium whitespace-nowrap text-foreground"
                >
                  {labels.thinking}
                </span>
              </span>
            </span>
          </span>
          <RollText
            text={labels.counter(seconds)}
            animate={seconds > 0}
            className="font-mono text-[12px] text-muted-foreground tabular-nums group-data-[state=done]/thinking:hidden"
          />
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={cn(
              "size-3 fill-none stroke-muted-foreground [stroke-width:1.6] opacity-0 [stroke-linecap:round] [stroke-linejoin:round] [transition:transform_.35s_cubic-bezier(.2,.8,.2,1),opacity_.3s] group-data-[state=done]/thinking:opacity-100",
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
          <div className="mt-2.5 mb-0.5 ml-[9px] border-l-2 border-muted pl-[18px] text-[13px] leading-[1.55] text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_LABELS: UiThinkingLabels = {
  thinking: "Thinking",
  done: (seconds) => `Thought for ${seconds}s`,
  counter: (seconds) => `${seconds}s`,
};

const WAVE_COLORS = {
  accent: ["--lumesec", "#6219f3"],
  glint: ["--lumesec-glint", "#c9bdff"],
} as const satisfies Record<string, ColorToken>;

/** One period of the wave in seconds: `sin(time * 5.5)` repeats every 2π / 5.5. */
const WAVE_PERIOD = (2 * Math.PI) / 5.5;
/** Frames in the strip: one period at 60 frames a second. The wave animation steps through them. */
const FRAMES = 69;

/** The strip moves left by its own width in one period, one frame per step. */
const WAVE_KEYFRAMES: Keyframe[] = [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }];

/*
 * The shimmer band is 62.4% of the label wide: the 38% to 62% ramp of a 260% gradient. It sweeps from
 * 0.3 label widths before the label to 0.3 widths past it in 1.9 s. The copy of the label inside the band moves
 * back by the same distance, so the text stays in place while the band passes over it.
 */
const BAND_KEYFRAMES: Keyframe[] = [{ transform: "translateX(-98.08%)" }, { transform: "translateX(158.33%)" }];
const BAND_TEXT_KEYFRAMES: Keyframe[] = [{ transform: "translateX(61.2%)" }, { transform: "translateX(-98.8%)" }];
const SHIMMER_TIMING: KeyframeAnimationOptions = {
  duration: 1900,
  iterations: Number.POSITIVE_INFINITY,
  easing: "linear",
};

/**
 * Draw `frames` frames of one wave period side by side, 20px apart, or the still frame alone with reduced motion.
 */
function drawStrip(
  context: CanvasRenderingContext2D,
  colors: Palette<keyof typeof WAVE_COLORS>,
  reduced: boolean,
  frames: number,
) {
  context.clearRect(0, 0, frames * 20, 14);
  for (let frame = 0; frame < (reduced ? 1 : frames); frame++) {
    context.save();
    context.translate(frame * 20, 0);
    drawWave(context, colors, (frame * WAVE_PERIOD) / FRAMES, reduced);
    context.restore();
  }
}

/** A 6 x 4 grid of 2px pixels; a sine wave runs through it and brightens toward the glint. */
function drawWave(
  context: CanvasRenderingContext2D,
  colors: Palette<keyof typeof WAVE_COLORS>,
  time: number,
  reduced: boolean,
) {
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

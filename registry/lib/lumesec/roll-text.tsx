"use client";

/**
 * LumeSec Elements: text that rolls over a horizontal axis when it changes, like a split-flap display.
 */
import * as React from "react";

import { prefersReducedMotion } from "@/lib/lumesec/motion";
import { cn } from "@/lib/utils";

/** Timing shared by every rolling label, with a small overshoot. */
export const ROLL_TIMING = { duration: 380, easing: "cubic-bezier(.3,1.3,.5,1)" } as const;

/** The control points of the `ROLL_TIMING` easing curve. */
const ROLL_CURVE = [0.3, 1.3, 0.5, 1] as const;

/**
 * The length of one roll animation. The roll takes the first `ROLL_TIMING.duration` of it and the end pose
 * holds for the rest. Chrome runs part of a short finite animation on the main thread, about twenty frames for each
 * 380ms roll. Each label slot instead keeps one long animation and seeks it back to the start for the next roll, so
 * the compositor runs it alone.
 */
const ROLL_LENGTH = 5000;

/** Masks the top and bottom 5px so the rotating text fades at the edges instead of clipping. */
const EDGE_MASK = "linear-gradient(to bottom, transparent 0, #000 5px, #000 calc(100% - 5px), transparent 100%)";

type Point = readonly [number, number];

const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const bezier = (points: readonly number[]) => `cubic-bezier(${points.map((value) => +value.toFixed(5)).join(",")})`;

/**
 * Splits the easing curve where its progress first reaches `progress`. Returns the time of the split and the easing
 * of each piece, so keyframes with an easing per segment follow the same curve as one eased animation.
 */
function splitCurve(progress: number) {
  const p0: Point = [0, 0];
  const p1: Point = [ROLL_CURVE[0], ROLL_CURVE[1]];
  const p2: Point = [ROLL_CURVE[2], ROLL_CURVE[3]];
  const p3: Point = [1, 1];
  const at = (u: number) => mix(mix(mix(p0, p1, u), mix(p1, p2, u), u), mix(mix(p1, p2, u), mix(p2, p3, u), u), u);
  // the curve overshoots and comes back, so find the first crossing: step up to it, then bisect
  let high = 0;
  while (high < 1 && at(high)[1] < progress) high += 1 / 64;
  let low = Math.max(0, high - 1 / 64);
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    if (at(middle)[1] < progress) low = middle;
    else high = middle;
  }
  const u = high;
  const a = mix(p0, p1, u);
  const b = mix(p1, p2, u);
  const c = mix(p2, p3, u);
  const d = mix(a, b, u);
  const e = mix(b, c, u);
  const m = mix(d, e, u);
  return {
    time: m[0],
    before: bezier([a[0] / m[0], a[1] / m[1], d[0] / m[0], d[1] / m[1]]),
    after: bezier([
      (e[0] - m[0]) / (1 - m[0]),
      (e[1] - m[1]) / (1 - m[1]),
      (c[0] - m[0]) / (1 - m[0]),
      (c[1] - m[1]) / (1 - m[1]),
    ]),
  };
}

/**
 * The keyframes of one roll over `ROLL_LENGTH`: from `from` to `to` degrees, with the opacity reaching its middle
 * value at `kink` of the eased progress. They match the 380ms animation `ROLL_TIMING` would run, then hold.
 */
function rollKeyframes(from: number, to: number, opacity: readonly [number, number, number], kink: number): Keyframe[] {
  const split = splitCurve(kink);
  const end = ROLL_TIMING.duration / ROLL_LENGTH;
  const turn = (progress: number) => `rotateX(${from + (to - from) * progress}deg)`;
  return [
    { offset: 0, opacity: opacity[0], transform: turn(0), easing: split.before },
    { offset: end * split.time, opacity: opacity[1], transform: turn(kink), easing: split.after },
    { offset: end, opacity: opacity[2], transform: turn(1) },
    { offset: 1, opacity: opacity[2], transform: turn(1) },
  ];
}

/** The keyframes of the outgoing and the incoming label, by direction. */
const ROLLS = new Map<number, { exit: Keyframe[]; enter: Keyframe[] }>();
function rollsFor(sign: number) {
  let rolls = ROLLS.get(sign);
  if (!rolls) {
    rolls = {
      exit: rollKeyframes(0, sign * 88, [1, 0.35, 0], 0.45),
      enter: rollKeyframes(-sign * 88, 0, [0, 1, 1], 0.55),
    };
    ROLLS.set(sign, rolls);
  }
  return rolls;
}

/** Starts a roll animation again from its first frame, without a new animation. */
function replay(animation: Animation) {
  if (animation.playState === "finished") animation.play();
  else animation.currentTime = 0;
}

interface RollState {
  text: string;
  /** The text rolling out, or null when no roll runs. */
  outgoing: string | null;
  direction: number;
  /** Counts the text changes. */
  turn: number;
}

interface Rolls {
  exit: Animation;
  enter: Animation;
  sign: number;
}

/** Props of {@link RollText}: the text and its roll, plus any `<span>` attribute except children. */
export interface RollTextProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** The text to show. Changing it rolls the old text out and the new text in. */
  text: string;
  /** 1 rolls upward (forward), -1 downward (back). */
  direction?: number;
  /** Set to false to swap the text without animating. */
  animate?: boolean;
  /**
   * Other texts this label can show. The slot reserves the width of the widest one, so a button whose
   * label changes never changes size.
   */
  reserve?: readonly string[];
}

/**
 * A label that rolls between values. Outgoing text is hidden from assistive technology, so screen readers
 * read only the current value. With reduced motion the text swaps instantly.
 */
export function RollText({ text, direction = 1, animate = true, reserve, className, style, ...props }: RollTextProps) {
  const [state, setState] = React.useState<RollState>(() => ({
    text,
    outgoing: null,
    direction,
    turn: 0,
  }));
  const outgoingRef = React.useRef<HTMLSpanElement>(null);
  const incomingRef = React.useRef<HTMLSpanElement>(null);
  const rolls = React.useRef<Rolls | null>(null);

  // Derive the roll during render, so the new text is in the first paint after the change.
  if (state.text !== text) {
    setState({ text, outgoing: state.text, direction, turn: state.turn + 1 });
  }

  const { turn, outgoing, direction: rollDirection } = state;
  React.useLayoutEffect(() => {
    if (outgoing === null) return;
    const settle = () => setState((value) => (value.turn === turn ? { ...value, outgoing: null } : value));
    const exitNode = outgoingRef.current;
    const enterNode = incomingRef.current;
    if (!animate || prefersReducedMotion() || !exitNode || !enterNode || typeof enterNode.animate !== "function") {
      rolls.current?.exit.cancel();
      rolls.current?.enter.cancel();
      rolls.current = null;
      settle();
      return;
    }
    const sign = rollDirection < 0 ? -1 : 1;
    const keyframes = rollsFor(sign);
    const current = rolls.current;
    if (!current) {
      rolls.current = {
        exit: exitNode.animate(keyframes.exit, { duration: ROLL_LENGTH, fill: "forwards" }),
        enter: enterNode.animate(keyframes.enter, { duration: ROLL_LENGTH, fill: "forwards" }),
        sign,
      };
    } else {
      if (current.sign !== sign) {
        (current.exit.effect as KeyframeEffect | null)?.setKeyframes(keyframes.exit);
        (current.enter.effect as KeyframeEffect | null)?.setKeyframes(keyframes.enter);
        current.sign = sign;
      }
      replay(current.exit);
      replay(current.enter);
    }
    // the outgoing text leaves when its roll ends, so the slot takes the width of the new text alone
    const timer = window.setTimeout(settle, ROLL_TIMING.duration);
    return () => window.clearTimeout(timer);
  }, [turn, outgoing, rollDirection, animate]);

  React.useEffect(
    () => () => {
      rolls.current?.exit.cancel();
      rolls.current?.enter.cancel();
      rolls.current = null;
    },
    [],
  );

  return (
    <span
      className={cn("-my-[5px] inline-grid justify-items-start py-[5px] [perspective:180px]", className)}
      style={{ maskImage: EDGE_MASK, WebkitMaskImage: EDGE_MASK, ...style }}
      {...props}
    >
      {reserve?.map((value, index) => (
        // a static list; the prefix keeps these keys apart from the numeric keys of the labels beside them
        <span
          key={`reserve-${index}`}
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-nowrap"
        >
          {value}
        </span>
      ))}
      <span
        ref={outgoingRef}
        aria-hidden="true"
        className="col-start-1 row-start-1 [transform-origin:50%_50%_-10px] whitespace-nowrap [backface-visibility:hidden]"
      >
        {outgoing}
      </span>
      <span
        ref={incomingRef}
        className="col-start-1 row-start-1 [transform-origin:50%_50%_-10px] whitespace-nowrap [backface-visibility:hidden]"
      >
        {state.text}
      </span>
    </span>
  );
}

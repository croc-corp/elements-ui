"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-stream.element";
import type * as ElementModule from "@/components/lumesec/hf-stream.element";

/** The `<hf-stream>` element, with its properties and methods. */
export type HfStreamElement = ElementModule.HStream;

export interface HfStreamProps extends Omit<LumesecElementProps<HfStreamElement>, "text" | "delay" | "loop" | "onStart" | "onDone"> {
  /** Text to stream. Defaults to a built-in sample paragraph. Split at whitespace; each word counts as one token. Re-read on each start. */
  text?: string;
  /** Milliseconds before the first stream starts after connect. Default: `500`. */
  delay?: number;
  /** Presence attribute. Starts again 3.5 s after a stream completes; not after Stop. Default: `false`. */
  loop?: boolean;
  /** Fires when a stream starts. */
  onStart?: (event: ElementModule.HStreamEventMap["start"]) => void;
  /** Fires when a stream completes or is stopped. */
  onDone?: (event: ElementModule.HStreamEventMap["done"]) => void;
}

/**
 * Streaming reply · `<hf-stream>` · LumeSec Elements, Pixel HD.
 * Streaming reply where each word resolves out of noise behind a glowing block caret, with a dotted tokens-per-second sparkline.
 *
 * Demo data: The streaming, its timing and the tokens-per-second figures are simulated; only the `text` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/stream
 */
export function HfStream({ text, delay, loop, onStart, onDone, ...props }: HfStreamProps) {
  return useLumesecElement(
    "hf-stream",
    props,
    { "text": text, "delay": delay, "loop": loop },
    { "start": onStart, "done": onDone },
  );
}

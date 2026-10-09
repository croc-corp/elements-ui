"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-run.element";
import type * as ElementModule from "@/components/lumesec/hf-run.element";

/** The `<hf-run>` element, with its properties and methods. */
export type HfRunElement = ElementModule.HRun;

export interface HfRunProps extends Omit<LumesecElementProps<HfRunElement>, "steps" | "label" | "autoplay" | "fail" | "onStep" | "onDone"> {
  /** Step labels separated by `|`; empty labels are skipped. Re-read at the start of each run. Default: `Plan the approach|Read 14 files|Edit src/auth.ts|Run test suite|Write summary`. */
  steps?: string;
  /** Title in the header. Read once on connect. Default: `Agent run`. */
  label?: string;
  /** Presence attribute. Starts a run 0.7 s after the element first connects. Default: `false`. */
  autoplay?: boolean;
  /** Zero-based index of the step that fails; the run stops there. Without the attribute every step succeeds. */
  fail?: number;
  /** Fires when a step starts and when it finishes. */
  onStep?: (event: ElementModule.HRunEventMap["step"]) => void;
  /** Fires when the run ends. `ok` is `false` when a step failed; `elapsed` is in seconds. */
  onDone?: (event: ElementModule.HRunEventMap["done"]) => void;
}

/**
 * Agent run · `<hf-run>` · LumeSec Elements, Pixel HD.
 * Simulated agent run: steps show a spinning arc while running and a carved check when done, with elapsed time and tokens on top.
 *
 * Demo data: Step durations are random and the token count is generated; only the step labels, `label` and the failing step can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/run
 */
export function HfRun({ steps, label, autoplay, fail, onStep, onDone, ...props }: HfRunProps) {
  return useLumesecElement(
    "hf-run",
    props,
    { "steps": steps, "label": label, "autoplay": autoplay, "fail": fail },
    { "step": onStep, "done": onDone },
  );
}

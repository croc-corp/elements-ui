"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-progress.element";
import type * as ElementModule from "@/components/lumesec/hf-progress.element";

/** The `<hf-progress>` element, with its properties and methods. */
export type HfProgressElement = ElementModule.HProgress;

export interface HfProgressProps extends Omit<LumesecElementProps<HfProgressElement>, "value" | "label" | "doneLabel" | "onComplete"> {
  /** Progress from 0 to 100, clamped. Observed. Without the attribute the bar is indeterminate. */
  value?: number;
  /** Label above the bar and the progressbar `aria-label`. Observed. Default: `Uploading`. */
  label?: string;
  /** Label shown once `value` reaches 100. Observed. Default: `Complete`. */
  doneLabel?: string;
  /** Fires when `value` reaches 100. Fires again only after the value drops below 100 and returns. */
  onComplete?: (event: ElementModule.HProgressEventMap["complete"]) => void;
}

/**
 * Progress · `<hf-progress>` · LumeSec Elements, Pixel HD.
 * Progress bar drawn as a fluid with rising bubbles; at 100% the label rolls to its done text. Omit `value` for indeterminate.
 *
 * Data: Set `value` from 0 to 100, or omit it for an indeterminate bar. The bubbles are decoration, not data.
 * @see https://elements.lumesec.ai/components/pixel-hd/progress
 */
export function HfProgress({ value, label, doneLabel, onComplete, ...props }: HfProgressProps) {
  return useLumesecElement(
    "hf-progress",
    props,
    { "value": value, "label": label, "done-label": doneLabel },
    { "complete": onComplete },
  );
}

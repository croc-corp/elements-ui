"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-fader.element";
import type * as ElementModule from "@/components/lumesec/px-fader.element";

/** The `<px-fader>` element, with its properties and methods. */
export type PxFaderElement = ElementModule.Fader;

export interface PxFaderProps extends Omit<LumesecElementProps<PxFaderElement>, "onChange"> {
  /** Fires when a drag on the fader ends, on each handled key press and on the double-click snap to 0 dB. `db` is the target level in decibels, `-Infinity` at the bottom, about +6 dB at the top. A quick click on the track reports the level the cap glides to, and the double-click snap reports exactly `0`. */
  onChange?: (event: ElementModule.FaderEventMap["change"]) => void;
}

/**
 * Fader & meter · `<px-fader>` · LumeSec Elements, Pixel Lab.
 * Mixing-desk fader beside a stereo pixel meter with falling peak-hold segments and a clip light above 0 dB.
 *
 * Demo data: The meter signal is simulated; only the fader position is a real control. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/fader
 */
export function PxFader({ onChange, ...props }: PxFaderProps) {
  return useLumesecElement(
    "px-fader",
    props,
    {},
    { "change": onChange },
  );
}

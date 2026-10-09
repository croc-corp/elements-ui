"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-tuner.element";
import type * as ElementModule from "@/components/lumesec/px-tuner.element";

/** The `<px-tuner>` element, with its properties and methods. */
export type PxTunerElement = ElementModule.Tuner;

export interface PxTunerProps extends Omit<LumesecElementProps<PxTunerElement>, "onLock"> {
  /** Fires each time the dial locks onto a station, with its name and frequency in MHz. */
  onLock?: (event: ElementModule.TunerEventMap["lock"]) => void;
}

/**
 * Radio tuner · `<px-tuner>` · LumeSec Elements, Pixel Lab.
 * FM radio tuner where static thins out near a station, a waveform appears and the name resolves on lock; release nearby springs onto it.
 *
 * Demo data: The four radio stations are invented; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/tuner
 */
export function PxTuner({ onLock, ...props }: PxTunerProps) {
  return useLumesecElement("px-tuner", props, {}, { lock: onLock });
}

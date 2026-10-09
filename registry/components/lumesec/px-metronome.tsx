"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-metronome.element";
import type * as ElementModule from "@/components/lumesec/px-metronome.element";

/** The `<px-metronome>` element, with its properties and methods. */
export type PxMetronomeElement = ElementModule.Metronome;

export interface PxMetronomeProps extends Omit<LumesecElementProps<PxMetronomeElement>, "bpm" | "onChange"> {
  /** Tempo, clamped to 40 to 208 and rounded. Changing it updates the tempo without firing `change`. Default: `96`. */
  bpm?: number;
  /** Fires whenever the tempo is set by the buttons, tap tempo or `setBpm()`. It does not fire when the element first connects or when the `bpm` attribute changes. */
  onChange?: (event: ElementModule.MetronomeEventMap["change"]) => void;
}

/**
 * Metronome · `<px-metronome>` · LumeSec Elements, Pixel Lab.
 * Pixel metronome with a swinging pendulum whose weight slides with tempo, four beat lamps, tap tempo and optional click sound.
 * @see https://elements.lumesec.ai/components/pixel-lab/metronome
 */
export function PxMetronome({ bpm, onChange, ...props }: PxMetronomeProps) {
  return useLumesecElement("px-metronome", props, { bpm: bpm }, { change: onChange });
}

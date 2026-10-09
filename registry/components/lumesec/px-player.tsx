"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-player.element";
import type * as ElementModule from "@/components/lumesec/px-player.element";

/** The `<px-player>` element, with its properties and methods. */
export type PxPlayerElement = ElementModule.Player;

export interface PxPlayerProps extends Omit<LumesecElementProps<PxPlayerElement>, "onPlay" | "onPause"> {
  /** Fires when playback starts. */
  onPlay?: (event: ElementModule.PlayerEventMap["play"]) => void;
  /** Fires when playback pauses, including when the track reaches the end. */
  onPause?: (event: ElementModule.PlayerEventMap["pause"]) => void;
}

/**
 * Waveform player · `<px-player>` · LumeSec Elements, Pixel Lab.
 * Pixel waveform player that fills as it plays, previews ahead of the playhead on hover and ripples from wherever you click.
 *
 * Demo data: The track, its length and its waveform are invented and no audio plays; nothing can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/player
 */
export function PxPlayer({ onPlay, onPause, ...props }: PxPlayerProps) {
  return useLumesecElement(
    "px-player",
    props,
    {},
    { "play": onPlay, "pause": onPause },
  );
}

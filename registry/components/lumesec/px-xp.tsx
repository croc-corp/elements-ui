"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-xp.element";
import type * as ElementModule from "@/components/lumesec/px-xp.element";

/** The `<px-xp>` element, with its properties and methods. */
export type PxXpElement = ElementModule.XP;

export interface PxXpProps extends Omit<LumesecElementProps<PxXpElement>, "level" | "onGain" | "onLevelup"> {
  /** Level, rounded to a whole number of at least 0. Changing it updates the number in place without firing `levelup`. Default: `7`. */
  level?: number;
  /** Fires on each gain with the amount added. */
  onGain?: (event: ElementModule.XPEventMap["gain"]) => void;
  /** Fires when the bar overflows, with the new level. */
  onLevelup?: (event: ElementModule.XPEventMap["levelup"]) => void;
}

/**
 * Level up · `<px-xp>` · LumeSec Elements, Pixel Lab.
 * XP bar with a hot leading edge; when it overflows the bar flashes and the level number bursts into pixels that reassemble as the next level.
 *
 * Demo data: The starting XP of 196 is invented; only `level` can be set and `gain()` adds to it. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-lab/xp
 */
export function PxXp({ level, onGain, onLevelup, ...props }: PxXpProps) {
  return useLumesecElement("px-xp", props, { level: level }, { gain: onGain, levelup: onLevelup });
}

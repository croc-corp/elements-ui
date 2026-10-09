"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/px-pattern.element";
import type * as ElementModule from "@/components/lumesec/px-pattern.element";

/** The `<px-pattern>` element, with its properties and methods. */
export type PxPatternElement = ElementModule.Pattern;

export interface PxPatternProps extends Omit<LumesecElementProps<PxPatternElement>, "pattern" | "onUnlock" | "onFail"> {
  /** The correct pattern as comma-separated node indexes 0 to 8, row by row from the top left, each at most once; a missing or invalid value uses the L `0,3,6,7,8`. List every node the line passes through, because skipped middle nodes join a drawn pattern. Read when a pattern is checked and when Show me runs; the "draw an L" hint shows only for the default. Default: `0,3,6,7,8`. */
  pattern?: string;
  /** Fires when the drawn pattern matches `pattern`. */
  onUnlock?: (event: ElementModule.PatternEventMap["unlock"]) => void;
  /** Fires when a pattern of two or more nodes does not match. */
  onFail?: (event: ElementModule.PatternEventMap["fail"]) => void;
}

/**
 * Pattern lock · `<px-pattern>` · LumeSec Elements, Pixel Lab.
 * 3x3 pattern lock with a pixel trail; skipped middle nodes join automatically, a wrong pattern shatters and falls, a right one turns green.
 * @see https://elements.lumesec.ai/components/pixel-lab/pattern
 */
export function PxPattern({ pattern, onUnlock, onFail, ...props }: PxPatternProps) {
  return useLumesecElement("px-pattern", props, { pattern: pattern }, { unlock: onUnlock, fail: onFail });
}

"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-reveal.element";
import type * as ElementModule from "@/components/lumesec/hf-reveal.element";

/** The `<hf-reveal>` element, with its properties and methods. */
export type HfRevealElement = ElementModule.HReveal;

export interface HfRevealProps extends Omit<
  LumesecElementProps<HfRevealElement>,
  "secret" | "hint" | "onToggle" | "onCopy"
> {
  /** Value to hide, reveal and copy. The default is a demo key. Observed: a change replaces the displayed value. Default: `sk-demo-Px9Qz7R4mW2vL8kT5nB1cJ6hD3fY0sA`. */
  secret?: string;
  /** Text beside the `API key` label while the secret is hidden. Observed. Default: `Hidden`. */
  hint?: string;
  /** Fires on every reveal or hide, including the automatic hide after 15 s. */
  onToggle?: (event: ElementModule.HRevealEventMap["toggle"]) => void;
  /** Fires after the Copy button or `copy()` is used. `ok` is `false` when the clipboard write was rejected. */
  onCopy?: (event: ElementModule.HRevealEventMap["copy"]) => void;
}

/**
 * Secret field · `<hf-reveal>` · LumeSec Elements, Pixel HD.
 * Secret field that hides its value under live static; revealing dissolves the noise outward from the click and re-hides after 15 s.
 *
 * Data: Pass the value to hide as `secret`. Without it a demo API key is shown.
 * @see https://elements.lumesec.ai/components/pixel-hd/reveal
 */
export function HfReveal({ secret, hint, onToggle, onCopy, ...props }: HfRevealProps) {
  return useLumesecElement("hf-reveal", props, { secret: secret, hint: hint }, { toggle: onToggle, copy: onCopy });
}

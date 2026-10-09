"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-rewind.element";
import type * as ElementModule from "@/components/lumesec/hf-rewind.element";

/** The `<hf-rewind>` element, with its properties and methods. */
export type HfRewindElement = ElementModule.HRewind;

export interface HfRewindProps extends Omit<LumesecElementProps<HfRewindElement>, "label" | "onPreview" | "onRestore"> {
  /** Heading text. Read once on connect. Default: `Checkpoints`. */
  label?: string;
  /** Fires when the head moves to another checkpoint by drag, click or key. */
  onPreview?: (event: ElementModule.HRewindEventMap["preview"]) => void;
  /** Fires when Restore is pressed, including on the latest checkpoint. */
  onRestore?: (event: ElementModule.HRewindEventMap["restore"]) => void;
}

/**
 * Checkpoints · `<hf-rewind>` · LumeSec Elements, Pixel HD.
 * Checkpoint scrubber for a coding session: each jump runs a rewind glitch over the code, and changed lines get a green bar.
 *
 * Demo data: The five checkpoints and their code are invented; only `label` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/rewind
 */
export function HfRewind({ label, onPreview, onRestore, ...props }: HfRewindProps) {
  return useLumesecElement("hf-rewind", props, { label: label }, { preview: onPreview, restore: onRestore });
}

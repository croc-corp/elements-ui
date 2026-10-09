"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-composer.element";
import type * as ElementModule from "@/components/lumesec/hf-composer.element";

/** The `<hf-composer>` element, with its properties and methods. */
export type HfComposerElement = ElementModule.HComposer;

export interface HfComposerProps extends Omit<LumesecElementProps<HfComposerElement>, "placeholder" | "model" | "effort" | "onSend" | "onEffort"> {
  /** Textarea placeholder. Observed. Default: `Reply to the agent…`. */
  placeholder?: string;
  /** Model name shown as plain text in the toolbar. Observed. Default: `Large`. */
  model?: string;
  /** Effort level, case-insensitive. An unrecognised value selects `High`. Observed: a change selects the level without an `effort` event. Default: `high`. */
  effort?: "low" | "medium" | "high" | "max" | "ultracode";
  /** Fires when a non-empty message is sent. `text` is trimmed; `effort` is the level label (`Low`, `Medium`, `High`, `Max` or `Ultracode`). The textarea is then cleared. */
  onSend?: (event: ElementModule.HComposerEventMap["send"]) => void;
  /** Fires when the user cycles the effort chip. `effort` is the new level label. */
  onEffort?: (event: ElementModule.HComposerEventMap["effort"]) => void;
}

/**
 * Prompt composer · `<hf-composer>` · LumeSec Elements, Pixel HD.
 * Chat input with an aurora border and an effort chip; Enter sends and fires a `send` event with the text and effort level.
 * @see https://elements.lumesec.ai/components/pixel-hd/composer
 */
export function HfComposer({ placeholder, model, effort, onSend, onEffort, ...props }: HfComposerProps) {
  return useLumesecElement(
    "hf-composer",
    props,
    { "placeholder": placeholder, "model": model, "effort": effort },
    { "send": onSend, "effort": onEffort },
  );
}

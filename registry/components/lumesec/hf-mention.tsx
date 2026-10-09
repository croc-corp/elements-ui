"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-mention.element";
import type * as ElementModule from "@/components/lumesec/hf-mention.element";

/** The `<hf-mention>` element, with its properties and methods. */
export type HfMentionElement = ElementModule.HMention;

export interface HfMentionProps extends Omit<LumesecElementProps<HfMentionElement>, "label" | "placeholder" | "value" | "name" | "disabled" | "onInput" | "onMention"> {
  /** Visible label of the textarea, associated with it through `<label for>`. Observed. Default: `Message`. */
  label?: string;
  /** Placeholder for the empty textarea. Observed. Default: `Type @ to mention a file, person or agent`. */
  placeholder?: string;
  /** Initial text. Read once on connect; omitting it or leaving it empty loads the demo sentence. Form reset restores it. Default: `Can @grace look at @src/auth/session.ts before we ship?`. */
  value?: string;
  /** Form field name used when the element is inside a form. */
  name?: string;
  /** Presence attribute. Disables the textarea; a disabled ancestor `<fieldset>` does the same. Default: `false`. */
  disabled?: boolean;
  /** Fires on each edit and after a mention is inserted, with the full text. */
  onInput?: (event: ElementModule.HMentionEventMap["input"]) => void;
  /** Fires when a suggestion is inserted. `value` is the mention without the `@`, for example `src/auth/session.ts`. */
  onMention?: (event: ElementModule.HMentionEventMap["mention"]) => void;
}

/**
 * @mention field · `<hf-mention>` · LumeSec Elements, Pixel HD.
 * Textarea with @mention suggestions for files, people and agents; matched letters are marked and inserted mentions become dotted chips.
 *
 * Demo data: The six suggestions (files, people and an agent) are invented; only `label`, `placeholder` and `value` can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/mention
 */
export function HfMention({ label, placeholder, value, name, disabled, onInput, onMention, ...props }: HfMentionProps) {
  return useLumesecElement(
    "hf-mention",
    props,
    { "label": label, "placeholder": placeholder, "value": value, "name": name, "disabled": disabled },
    { "input": onInput, "mention": onMention },
  );
}

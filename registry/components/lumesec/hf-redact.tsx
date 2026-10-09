"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-redact.element";
import type * as ElementModule from "@/components/lumesec/hf-redact.element";

/** The `<hf-redact>` element, with its properties and methods. */
export type HfRedactElement = ElementModule.HRedact;

export interface HfRedactProps extends Omit<LumesecElementProps<HfRedactElement>, "names" | "label" | "onChange"> {
  /** Comma-separated names to redact, matched exactly and case-sensitively. Default: `Jane Doe`. */
  names?: string;
  /** Heading text. Read once on connect. Default: `Before it leaves your device`. */
  label?: string;
  /** Fires on connect, when the Redact switch changes and 160 ms after the text is edited. `text` is the output pane: placeholders when `redacted` is `true`, the original otherwise. */
  onChange?: (event: ElementModule.HRedactEventMap["change"]) => void;
}

/**
 * PII redaction · `<hf-redact>` · LumeSec Elements, Pixel HD.
 * Shows text next to what a model would see, with names, emails, IBANs and phone numbers swapped for placeholders like EMAIL_1.
 *
 * Data: Pass your text as the element's text content and the names to redact as `names`. Without them a built-in sample is redacted.
 * @see https://elements.lumesec.ai/components/pixel-hd/redact
 */
export function HfRedact({ names, label, onChange, ...props }: HfRedactProps) {
  return useLumesecElement(
    "hf-redact",
    props,
    { "names": names, "label": label },
    { "change": onChange },
  );
}

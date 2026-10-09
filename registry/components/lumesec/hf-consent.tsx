"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-consent.element";
import type * as ElementModule from "@/components/lumesec/hf-consent.element";

/** The `<hf-consent>` element, with its properties and methods. */
export type HfConsentElement = ElementModule.HConsent;

export interface HfConsentProps extends Omit<LumesecElementProps<HfConsentElement>, "label" | "description" | "onConsent"> {
  /** Card title; also labels the card region. Observed. Default: `Your privacy choices`. */
  label?: string;
  /** Text under the title. Observed. Default: `We only use what you allow. You can change this any time in Settings.`. */
  description?: string;
  /** Fires on Reject all, Save choices or Accept all with the chosen categories. Necessary is always on and not reported. */
  onConsent?: (event: ElementModule.HConsentEventMap["consent"]) => void;
}

/**
 * Privacy choices · `<hf-consent>` · LumeSec Elements, Pixel HD.
 * Privacy choices card whose shield fills as categories are allowed; saving stamps it and folds the card into a small Change pill.
 * @see https://elements.lumesec.ai/components/pixel-hd/consent
 */
export function HfConsent({ label, description, onConsent, ...props }: HfConsentProps) {
  return useLumesecElement(
    "hf-consent",
    props,
    { "label": label, "description": description },
    { "consent": onConsent },
  );
}

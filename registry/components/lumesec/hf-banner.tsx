"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-banner.element";
import type * as ElementModule from "@/components/lumesec/hf-banner.element";

/** The `<hf-banner>` element, with its properties and methods. */
export type HfBannerElement = ElementModule.HBanner;

export interface HfBannerProps extends Omit<LumesecElementProps<HfBannerElement>, "action" | "variant" | "onAction" | "onDismiss"> {
  /** Label of the action button. An empty value hides the button. Observed. Default: `Try it`. */
  action?: string;
  /** Colour scheme: `ok` (green) or `warn` (amber). Without it the accent colour is used. Observed. */
  variant?: "ok" | "warn";
  /** Fires when the action button is clicked. */
  onAction?: (event: ElementModule.HBannerEventMap["action"]) => void;
  /** Fires when the disintegration ends and the collapse begins: about 0.95 s after dismissing, or at once with reduced motion. */
  onDismiss?: (event: ElementModule.HBannerEventMap["dismiss"]) => void;
}

/**
 * Announcement · `<hf-banner>` · LumeSec Elements, Pixel HD.
 * Announcement banner on a dithered gradient with a passing sheen; dismissing breaks it into dots that blow away before it collapses.
 * @see https://elements.lumesec.ai/components/pixel-hd/banner
 */
export function HfBanner({ action, variant, onAction, onDismiss, ...props }: HfBannerProps) {
  return useLumesecElement(
    "hf-banner",
    props,
    { "action": action, "variant": variant },
    { "action": onAction, "dismiss": onDismiss },
  );
}

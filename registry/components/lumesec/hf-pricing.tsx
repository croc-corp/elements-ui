"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-pricing.element";
import type * as ElementModule from "@/components/lumesec/hf-pricing.element";

/** The `<hf-pricing>` element, with its properties and methods. */
export type HfPricingElement = ElementModule.HPricing;

export interface HfPricingProps extends Omit<
  LumesecElementProps<HfPricingElement>,
  "plan" | "monthly" | "yearly" | "period" | "currency" | "features" | "onChange"
> {
  /** Plan name above the price. Default: `Pro`. */
  plan?: string;
  /** Price per month on monthly billing. Default: `20`. */
  monthly?: number;
  /** Price per month on yearly billing. The note under the price shows twelve times this value. Default: `16`. */
  yearly?: number;
  /** Initial billing period. Any value other than `monthly` selects yearly. Default: `yearly`. */
  period?: "monthly" | "yearly";
  /** Currency symbol placed before the price. Default: `€`. */
  currency?: string;
  /** Feature list, separated by `|`. Default: `Ultracode and multi-agent workflows|Priority access at peak times|Projects with shared context`. */
  features?: string;
  /** Fires when the user switches billing period. `price` is the per-month price for that period. */
  onChange?: (event: ElementModule.HPricingEventMap["change"]) => void;
}

/**
 * Pricing · `<hf-pricing>` · LumeSec Elements, Pixel HD.
 * Pricing card with a monthly and yearly toggle; the price rolls to the new number while a bright edge wipes through the dot grid behind it.
 *
 * Demo data: The `−20%` badge on Yearly is fixed text, not computed; plan, prices, currency and features can be set. It cannot show your own data yet; use it as a template.
 * @see https://elements.lumesec.ai/components/pixel-hd/pricing
 */
export function HfPricing({ plan, monthly, yearly, period, currency, features, onChange, ...props }: HfPricingProps) {
  return useLumesecElement(
    "hf-pricing",
    props,
    { plan: plan, monthly: monthly, yearly: yearly, period: period, currency: currency, features: features },
    { change: onChange },
  );
}

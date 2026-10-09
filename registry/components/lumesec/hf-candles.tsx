"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-candles.element";
import type * as ElementModule from "@/components/lumesec/hf-candles.element";

/** The `<hf-candles>` element, with its properties and methods. */
export type HfCandlesElement = ElementModule.HCandles;

export interface HfCandlesProps extends Omit<LumesecElementProps<HfCandlesElement>, "ticker" | "data"> {
  /** Symbol shown in the header and used in the chart's `aria-label`. Observed. Default: `GPU·H`. */
  ticker?: string;
  /** Candles, oldest first: `{ open, high, low, close, volume?, date? }` records (`date` as an ISO string or epoch ms). The chart shows the last 56. Observed: changing it redraws the chart. Without it the chart shows a demo random walk that ticks live. */
  data?: readonly ElementModule.HfCandlesDatum[];
}

/**
 * Candlesticks · `<hf-candles>` · LumeSec Elements, Pixel HD.
 * Candlestick chart with dithered bodies, wicks, volume and a last-price line; takes your OHLC candles and streams new ones with `push()`, or shows a live demo walk.
 *
 * Data: Pass your OHLC candles as `data` and stream new ones with `push()`. Without it the chart shows a demo random walk that ticks live.
 * @see https://elements.lumesec.ai/components/pixel-hd/candles
 */
export function HfCandles({ ticker, data, ...props }: HfCandlesProps) {
  return useLumesecElement("hf-candles", props, { ticker: ticker, data: data }, {});
}

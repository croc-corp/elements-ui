"use client";

import { useLumesecElement, type LumesecElementProps } from "@/lib/lumesec/react";
import "@/components/lumesec/hf-leaderboard.element";
import type * as ElementModule from "@/components/lumesec/hf-leaderboard.element";

/** The `<hf-leaderboard>` element, with its properties and methods. */
export type HfLeaderboardElement = ElementModule.HLeaderboard;

export interface HfLeaderboardProps extends Omit<LumesecElementProps<HfLeaderboardElement>, "label" | "data"> {
  /** Heading text. Observed. Default: `Merged PRs this quarter`. */
  label?: string;
  /** Rows as `{ name, value }` records, in any order; they are ranked by `value`, highest first. Observed: each change re-ranks the rows with the slide, trail and delta animations. Without it six demo teams receive random score increases. */
  data?: readonly ElementModule.HfLeaderboardDatum[];
}

/**
 * Live leaderboard · `<hf-leaderboard>` · LumeSec Elements, Pixel HD.
 * Leaderboard: rows rank by score, overtaking rows slide past each other with trails, ranks roll, changes flash and the leader gets a ring; takes your rows or shows live demo teams.
 *
 * Data: Pass your rows as `data` (`{ name, value }`); they are ranked and re-ranked as you update them. Without it six demo teams receive random score increases.
 * @see https://elements.lumesec.ai/components/pixel-hd/leaderboard
 */
export function HfLeaderboard({ label, data, ...props }: HfLeaderboardProps) {
  return useLumesecElement("hf-leaderboard", props, { label: label, data: data }, {});
}

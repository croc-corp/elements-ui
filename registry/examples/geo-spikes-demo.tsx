"use client";

import * as React from "react";

import { GeoSpikes, type SpikeDatum } from "@/components/lumesec/geo-spikes";
import { createRandom, findCity } from "@/lib/lumesec/geo-data";

/** The 24 demo cities, spread over every continent. */
const CITY_IDS = "lhr cdg fra ams mad ist jfk ord sfo lax yyz mex gru bog eze los cai jnb dxb bom sin nrt icn syd".split(" ");

/**
 * Invented counts for one refresh. Round 0 is the baseline; every later round drifts each city a little and makes
 * three cities jump, so the wave starts from the biggest increase.
 */
function demoCounts(round: number): SpikeDatum[] {
  const base = createRandom("geo-spikes");
  const drift = createRandom(round * 7919 + 13);
  const jumps = new Set<number>();
  while (round > 0 && jumps.size < 3) jumps.add(Math.floor(drift() * CITY_IDS.length));
  const result: SpikeDatum[] = [];
  CITY_IDS.forEach((id, index) => {
    const city = findCity(id);
    if (!city) return;
    let value = 42000 * Math.pow(city.weight, 2.2) * (0.7 + 0.6 * base());
    if (round > 0) value *= jumps.has(index) ? 2.2 + drift() * 2.6 : 0.82 + drift() * 0.3;
    result.push({ id, label: city.name, lat: city.lat, lon: city.lon, value: Math.round(value) });
  });
  return result;
}

export default function GeoSpikesDemo() {
  const [round, setRound] = React.useState(0);
  const data = React.useMemo(() => demoCounts(round), [round]);
  return (
    <div className="relative w-full max-w-[400px]">
      <GeoSpikes data={data} />
      <button
        type="button"
        onClick={() => setRound((value) => value + 1)}
        className="absolute top-3 right-3 z-[4] h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
      >
        Refresh
      </button>
    </div>
  );
}

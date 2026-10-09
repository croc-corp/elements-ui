"use client";

import * as React from "react";

import { GeoLatencyMatrix, type LatencyMeasurement, type LatencyPair, type LatencyRegion } from "@/components/lumesec/geo-latency-matrix";
import { createRandom, demoLatency, findRegion } from "@/lib/lumesec/geo-data";

const REGIONS: LatencyRegion[] = ["us-west", "us-east", "sa-east", "eu-central", "af-south", "ap-southeast", "ap-northeast", "au-east"].flatMap(
  (id) => {
    const region = findRegion(id);
    return region ? [{ id: region.id, label: region.label, city: region.city, lat: region.lat, lon: region.lon }] : [];
  },
);

/** Demo round: round 0 is the plain demo latency; later rounds wander by up to about 15 % around it. */
function measure(round: number): LatencyMeasurement[] {
  const random = createRandom(`latency-${round}`);
  return REGIONS.flatMap((from, row) =>
    REGIONS.slice(row + 1).map((to) => {
      const base = demoLatency(from, to);
      const factor = round === 0 ? 1 : 0.88 + random() * 0.3;
      return { from: from.id, to: to.id, ms: Math.round(base * factor) };
    }),
  );
}

export default function GeoLatencyMatrixDemo() {
  const [round, setRound] = React.useState(0);
  const measurements = React.useMemo(() => measure(round), [round]);
  const [pair, setPair] = React.useState<LatencyPair | null>({ from: "eu-central", to: "ap-southeast" });

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoLatencyMatrix regions={REGIONS} measurements={measurements} value={pair} onValueChange={setPair} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setRound((value) => value + 1)}
          className="h-[30px] shrink-0 cursor-pointer rounded-lg whitespace-nowrap border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
        >
          Measure again
        </button>
        <span className="hidden text-[12px] text-muted-foreground sm:inline">Demo latencies: the fibre minimum times a seeded stretch.</span>
      </div>
    </div>
  );
}

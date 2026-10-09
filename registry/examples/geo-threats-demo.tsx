"use client";

import * as React from "react";

import { GeoThreats, type GeoThreatsHandle } from "@/components/lumesec/geo-threats";
import { createRandom, findCity, scatterAround } from "@/lib/lumesec/geo-data";

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

/** A flood comes from two places at once, around São Paulo and around Delhi (invented demo traffic). */
const FLOOD_SOURCES = ["gru", "del"] as const;
const FLOOD_SIZE = 40;
const FLOOD_MS = 2000;
const FLOOD_SPREAD_KM = 240;

export default function GeoThreatsDemo() {
  const threats = React.useRef<GeoThreatsHandle>(null);
  const timers = React.useRef(new Set<number>());
  const round = React.useRef(0);

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /** Pushes 40 blocked requests from the two sources over 2 s, alternating between them. */
  function flood() {
    const wave = round.current++;
    const random = createRandom(`flood-${wave}`);
    for (let i = 0; i < FLOOD_SIZE; i++) {
      const timer = window.setTimeout(
        () => {
          timers.current.delete(timer);
          const city = findCity(FLOOD_SOURCES[i % FLOOD_SOURCES.length]);
          if (!city) return;
          const origin = scatterAround(random, city, FLOOD_SPREAD_KM, true);
          threats.current?.push({ id: `flood-${wave}-${i}`, lat: origin.lat, lon: origin.lon, verdict: "blocked" });
        },
        (i * FLOOD_MS) / FLOOD_SIZE,
      );
      timers.current.add(timer);
    }
  }

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoThreats ref={threats} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} onClick={flood}>
          Flood
        </button>
        <span className="ml-auto text-[12px] text-muted-foreground">Demo data, invented origins</span>
      </div>
    </div>
  );
}

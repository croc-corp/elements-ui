"use client";

import * as React from "react";

import { GeoMarkerMap, type GeoMarkerMapGrid, type MapMarker } from "@/components/lumesec/geo-marker-map";
import { DEMO_CITIES, formatCompact, formatNumber } from "@/lib/lumesec/geo-data";
import { RollText } from "@/lib/lumesec/roll-text";
import { cn } from "@/lib/utils";

/** Invented requests per minute at 14 edge locations; São Paulo is degraded. */
const START: readonly (readonly [id: string, value: number, extra?: Partial<MapMarker>])[] = [
  ["lhr", 48200, { pulse: true }],
  ["jfk", 52600],
  ["nrt", 41200, { pulse: true }],
  ["sfo", 36400],
  ["sin", 33900],
  ["fra", 31800],
  ["bom", 27300],
  ["gru", 21400, { tone: "warning", pulse: true }],
  ["ord", 18900],
  ["dxb", 14800],
  ["syd", 12600],
  ["mex", 9800],
  ["los", 7600],
  ["jnb", 6400],
];

const INITIAL: MapMarker[] = START.flatMap(([id, value, extra]) => {
  const city = DEMO_CITIES.find((entry) => entry.id === id);
  return city ? [{ id, label: city.name, lat: city.lat, lon: city.lon, value, ...extra }] : [];
});

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoMarkerMapDemo() {
  const [markers, setMarkers] = React.useState<MapMarker[]>(INITIAL);
  const [grid, setGrid] = React.useState<GeoMarkerMapGrid>("honeycomb");
  const [selected, setSelected] = React.useState<string | null>(null);

  const total = markers.reduce((sum, marker) => sum + (marker.value ?? 0), 0);
  const current = markers.find((marker) => marker.id === selected) ?? null;
  const shown = current ? (current.value ?? 0) : total;

  // derived state: which way the readout rolls
  const [readout, setReadout] = React.useState({ value: shown, direction: 1 });
  if (readout.value !== shown) setReadout({ value: shown, direction: shown >= readout.value ? 1 : -1 });

  function shuffle() {
    setMarkers((list) =>
      list.map((marker) => {
        const factor = 0.3 + Math.random() * 1.6;
        return { ...marker, value: Math.round(clampValue((marker.value ?? 0) * factor) / 100) * 100 };
      }),
    );
  }

  return (
    <div className="w-full max-w-[660px] rounded-[14px] border border-border bg-card px-5 pt-4 pb-[18px] text-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] leading-5 font-medium">Edge requests</div>
          <div className="text-[12px] leading-4 text-muted-foreground">Per minute, by location</div>
        </div>
        <div className="flex items-baseline gap-2 text-right" aria-live="polite">
          <span className="truncate text-[12px] text-muted-foreground">{current ? current.label : "All locations"}</span>
          <RollText
            text={formatNumber(shown)}
            direction={readout.direction}
            className="font-mono text-[18px] leading-6 font-medium tabular-nums"
          />
        </div>
      </div>
      <GeoMarkerMap markers={markers} grid={grid} value={selected} onValueChange={setSelected} format={formatCompact} label="Requests per minute by edge location" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={shuffle} className={BUTTON}>
          Shuffle values
        </button>
        <div role="group" aria-label="Grid" className="flex gap-1">
          {(["honeycomb", "square"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={grid === option}
              onClick={() => setGrid(option)}
              className={cn(
                BUTTON,
                "aria-pressed:border-[color-mix(in_srgb,var(--lumesec)_55%,var(--border))] aria-pressed:bg-lumesec/8 aria-[pressed=false]:text-muted-foreground",
              )}
            >
              {option === "honeycomb" ? "Honeycomb" : "Square"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Keeps shuffled values in a believable range. */
function clampValue(value: number) {
  return Math.min(90000, Math.max(1200, value));
}

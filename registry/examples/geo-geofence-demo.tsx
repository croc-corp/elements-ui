"use client";

import * as React from "react";

import { GeoGeofence, type GeofenceZone } from "@/components/lumesec/geo-geofence";

/** The two demo zones: 1,200 km around Paris and 900 km around New York. */
const INITIAL_ZONES: readonly GeofenceZone[] = [
  { id: "western-europe", label: "Western Europe", center: { lat: 48.8566, lon: 2.3522 }, radiusKm: 1200 },
  { id: "east-coast", label: "East coast", center: { lat: 40.7128, lon: -74.006 }, radiusKm: 900 },
];

/** Smallest radius the Shrink button goes down to, in km. */
const SHRINK_FLOOR_KM = 150;

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-50 disabled:hover:border-border";

/** Each press takes a zone to 55 % of its radius, rounded to 10 km, so trackers near the fence fall outside. */
function shrinkZone(zone: GeofenceZone): GeofenceZone {
  const radiusKm = Math.max(SHRINK_FLOOR_KM, Math.round((zone.radiusKm * 0.55) / 10) * 10);
  return { ...zone, radiusKm };
}

export default function GeoGeofenceDemo() {
  const [zones, setZones] = React.useState<readonly GeofenceZone[]>(INITIAL_ZONES);
  const changed = zones !== INITIAL_ZONES;
  const canShrink = zones.some((zone) => zone.radiusKm > SHRINK_FLOOR_KM);

  return (
    <div className="grid w-full max-w-[660px] gap-3">
      <GeoGeofence zones={zones} onZonesChange={setZones} label="Tracker zones" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setZones((current) => current.map(shrinkZone))}
          disabled={!canShrink}
          className={BUTTON}
        >
          Shrink zones
        </button>
        <button type="button" onClick={() => setZones(INITIAL_ZONES)} disabled={!changed} className={BUTTON}>
          Reset
        </button>
      </div>
    </div>
  );
}

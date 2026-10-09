"use client";

import * as React from "react";

import { GeoDaynight } from "@/components/lumesec/geo-daynight";

const HOUR_MS = 3_600_000;

export default function GeoDaynightDemo() {
  // undefined: the globe follows the clock on its own; a number: the demo drives it
  const [value, setValue] = React.useState<number | undefined>(undefined);
  const [playing, setPlaying] = React.useState(false);
  const cursor = React.useRef(0);
  const end = React.useRef(0);

  // one hour every 0.4 s, from 12 hours ago to 12 hours ahead
  React.useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      cursor.current = Math.min(cursor.current + HOUR_MS, end.current);
      setValue(cursor.current);
      if (cursor.current >= end.current) setPlaying(false);
    }, 400);
    return () => window.clearInterval(id);
  }, [playing]);

  function play() {
    if (playing) {
      setPlaying(false);
      return;
    }
    const now = Date.now();
    end.current = now + 12 * HOUR_MS;
    cursor.current = now - 12 * HOUR_MS;
    setValue(cursor.current);
    setPlaying(true);
  }

  function handleValueChange(next: number) {
    setPlaying(false);
    // back at now: hand the clock back to the globe so it stays live
    setValue(Math.abs(next - Date.now()) < 60_000 ? undefined : next);
  }

  return (
    <div className="relative w-full max-w-[400px]">
      <GeoDaynight value={value} onValueChange={handleValueChange} />
      {/* the stage's top corner stays clear of the globe, so the demo control sits there */}
      <button
        type="button"
        onClick={play}
        aria-pressed={playing}
        className="absolute top-0 right-0 h-[30px] min-w-[84px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec"
      >
        {playing ? "Stop" : "Play 24 h"}
      </button>
    </div>
  );
}

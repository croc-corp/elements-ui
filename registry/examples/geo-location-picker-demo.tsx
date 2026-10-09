"use client";

import * as React from "react";

import { GeoLocationPicker } from "@/components/lumesec/geo-location-picker";

/** New York, one of the demo places, so the picker opens with a pin and its name under the map. */
const START = { lat: 40.7128, lon: -74.006 };

const BUTTON =
  "h-[30px] shrink-0 cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoLocationPickerDemo() {
  const [submitted, setSubmitted] = React.useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields = ["site-lat", "site-lon"].flatMap((key) => {
      const entry = data.get(key);
      return typeof entry === "string" ? [`${key}=${entry}`] : [];
    });
    setSubmitted(fields.join("  "));
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-[400px] gap-3">
      <GeoLocationPicker name="site" snap={25} defaultValue={START} label="Site location" />
      <div className="flex min-w-0 items-center gap-3">
        <button type="submit" className={BUTTON}>
          Submit
        </button>
        <output className="min-w-0 truncate text-[12.5px] leading-5 text-muted-foreground">
          {submitted === null ? (
            "Not submitted yet"
          ) : submitted ? (
            <>
              Submitted <span className="font-mono text-foreground tabular-nums">{submitted}</span>
            </>
          ) : (
            "Submitted without a pin"
          )}
        </output>
      </div>
    </form>
  );
}

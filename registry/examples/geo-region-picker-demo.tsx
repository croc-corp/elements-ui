"use client";

import * as React from "react";

import { GeoRegionPicker } from "@/components/lumesec/geo-region-picker";
import { DEMO_REGIONS } from "@/lib/lumesec/geo-data";

const MADRID_OFFICE = { lat: 40.4168, lon: -3.7038, label: "Madrid office" };

const BUTTON =
  "h-[30px] shrink-0 cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec";

export default function GeoRegionPickerDemo() {
  const [submitted, setSubmitted] = React.useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const region = new FormData(event.currentTarget).get("region");
    setSubmitted(typeof region === "string" ? region : "");
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-[400px] gap-3">
      <GeoRegionPicker name="region" regions={DEMO_REGIONS} from={MADRID_OFFICE} label="Deployment region" />
      <div className="flex min-w-0 items-center gap-3">
        <button type="submit" className={BUTTON}>
          Submit
        </button>
        <output className="min-w-0 truncate text-[12.5px] leading-5 text-muted-foreground">
          {submitted === null ? (
            "Not submitted yet"
          ) : (
            <>
              Submitted <span className="font-mono text-foreground">region={submitted || "(none)"}</span>
            </>
          )}
        </output>
      </div>
    </form>
  );
}

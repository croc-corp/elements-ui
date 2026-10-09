"use client";

import * as React from "react";

import { GeoSessions } from "@/components/lumesec/geo-sessions";

const BUTTON =
  "h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec disabled:cursor-default disabled:opacity-50 disabled:hover:border-border";

export default function GeoSessionsDemo() {
  // Restore mounts a fresh panel with the six demo sessions
  const [run, setRun] = React.useState(0);
  const [signedOut, setSignedOut] = React.useState(false);

  return (
    <div className="grid w-full max-w-[400px] justify-items-center gap-3">
      <GeoSessions key={run} onSessionsChange={(sessions) => setSignedOut(sessions.length < 6)} />
      <button
        type="button"
        disabled={!signedOut}
        onClick={() => {
          setRun((value) => value + 1);
          setSignedOut(false);
        }}
        className={BUTTON}
      >
        Restore sessions
      </button>
    </div>
  );
}

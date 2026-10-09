"use client";

import * as React from "react";

import { PxAlert } from "@/components/lumesec/px-alert";

const controlButton =
  "h-[30px] rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))]";

export default function PxAlertDemo() {
  const [usageOpen, setUsageOpen] = React.useState(true);
  const [syncOpen, setSyncOpen] = React.useState(true);

  return (
    <div className="grid w-full max-w-[380px] gap-[14px]">
      <PxAlert type="info" heading="New model available">
        The large model is now the default for new chats.
      </PxAlert>
      <PxAlert type="warning" heading="Usage at 85%" dismissible open={usageOpen} onOpenChange={setUsageOpen}>
        You’ve used most of this week’s limit.
      </PxAlert>
      <PxAlert type="error" heading="Sync failed" dismissible open={syncOpen} onOpenChange={setSyncOpen}>
        We couldn’t reach Google Drive. Check the connection.
      </PxAlert>
      <div className="flex flex-wrap justify-center gap-1.5">
        <button
          type="button"
          className={controlButton}
          onClick={() => {
            setUsageOpen(true);
            setSyncOpen(true);
          }}
        >
          Show dismissed
        </button>
      </div>
    </div>
  );
}

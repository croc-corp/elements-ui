"use client";

import * as React from "react";

import { PxCheckbox, type PxCheckedState } from "@/components/lumesec/px-checkbox";

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "push", label: "Push" },
  { value: "sms", label: "SMS" },
] as const;

type Channel = (typeof CHANNELS)[number]["value"];

export default function PxCheckboxDemo() {
  const [selected, setSelected] = React.useState<Record<Channel, boolean>>({ email: true, push: false, sms: false });
  const count = CHANNELS.filter((channel) => selected[channel.value]).length;
  // the parent is checked when every child is, and mixed when some are
  const all: PxCheckedState = count === CHANNELS.length ? true : count > 0 ? "indeterminate" : false;

  return (
    <div className="grid gap-2">
      <span className="text-[12.5px] font-medium">Notify me by</span>
      <PxCheckbox
        checked={all}
        onCheckedChange={(checked) =>
          setSelected({ email: checked === true, push: checked === true, sms: checked === true })
        }
      >
        All channels
      </PxCheckbox>
      {CHANNELS.map((channel) => (
        <PxCheckbox
          key={channel.value}
          name="notify"
          value={channel.value}
          checked={selected[channel.value]}
          onCheckedChange={(checked) => setSelected((previous) => ({ ...previous, [channel.value]: checked === true }))}
          className="ml-[28px]"
        >
          {channel.label}
        </PxCheckbox>
      ))}
    </div>
  );
}

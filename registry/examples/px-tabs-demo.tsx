import { PxTabs } from "@/components/lumesec/px-tabs";

export default function PxTabsDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxTabs
        items={[
          { label: "Overview", content: "Usage is steady this week. Most runs come from the Research project." },
          { label: "Activity", count: 12, content: "12 events since Monday, including 3 deploys and 2 new members." },
          { label: "Settings", content: "Default model, retention and notification settings live here." },
        ]}
      />
    </div>
  );
}

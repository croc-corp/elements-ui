import { PxDate } from "@/components/lumesec/px-date";

export default function PxDateDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxDate name="trip" range defaultValue="2026-10-20/2026-10-24" />
    </div>
  );
}

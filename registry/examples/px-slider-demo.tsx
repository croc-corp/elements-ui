import { PxSlider } from "@/components/lumesec/px-slider";

export default function PxSliderDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-5 py-[18px] shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <PxSlider name="budget" label="Monthly budget" min={0} max={500} step={10} defaultValue={120} prefix="€" ticks />
    </div>
  );
}

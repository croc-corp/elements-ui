import { GeoAzimuthal } from "@/components/lumesec/geo-azimuthal";

export default function GeoAzimuthalDemo() {
  return (
    <div className="w-full max-w-[660px] rounded-[14px] border border-border bg-card px-5 py-[18px] text-foreground shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <GeoAzimuthal defaultCenter="lhr" />
    </div>
  );
}

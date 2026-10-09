import { GeoProbes } from "@/components/lumesec/geo-probes";

export default function GeoProbesDemo() {
  // the built-in demo: eu-central checked from 12 probes; every third round one probe times out
  return <GeoProbes className="w-full max-w-[660px]" />;
}

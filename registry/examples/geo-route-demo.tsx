import { GeoRoute } from "@/components/lumesec/geo-route";

export default function GeoRouteDemo() {
  return (
    <div className="grid w-full max-w-[660px] gap-2">
      <GeoRoute />
      <p className="m-0 px-1 text-[11.5px] leading-4 text-muted-foreground">
        Demo data: an invented container-ship voyage from Rotterdam to Singapore via Suez, with port stops.
      </p>
    </div>
  );
}

import { GeoMiniMap, type GeoMiniMapTone, type MiniMapLocation } from "@/components/lumesec/geo-mini-map";
import { findCity } from "@/lib/lumesec/geo-data";

interface SignIn {
  id: string;
  user: string;
  device: string;
  time: string;
  location: MiniMapLocation;
  tone?: GeoMiniMapTone;
}

/** A demo city as a location, with an invented address from the documentation ranges. */
function place(id: string, detail: string): MiniMapLocation {
  const city = findCity(id);
  if (!city) return { lat: 0, lon: 0 };
  return { lat: city.lat, lon: city.lon, label: city.name, detail, timeZone: city.timeZone };
}

/** The reference point of the distance row. */
const ORIGIN = findCity("fra");
const FROM = ORIGIN ? { lat: ORIGIN.lat, lon: ORIGIN.lon, label: ORIGIN.name } : undefined;

const SIGN_INS: SignIn[] = [
  { id: "s1", user: "Priya Raman", device: "Laptop", time: "09:41", location: place("blr", "203.0.113.24") },
  { id: "s2", user: "Jonas Weber", device: "Phone", time: "09:12", location: place("ham", "198.51.100.7") },
  { id: "s3", user: "Lucía Ortega", device: "Laptop", time: "08:57", location: place("gru", "192.0.2.140") },
  { id: "s4", user: "Kenji Mori", device: "Tablet", time: "08:30", location: place("nrt", "203.0.113.88") },
  {
    id: "s5",
    user: "Amara Okafor",
    device: "New device",
    time: "07:58",
    location: place("los", "198.51.100.212 · first sign-in from here"),
    tone: "warning",
  },
];

export default function GeoMiniMapDemo() {
  return (
    <div className="w-full max-w-[400px] rounded-[14px] border border-border bg-card px-4 pt-3.5 pb-1.5 shadow-[0_14px_34px_-20px_rgb(0_0_0/0.4)]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[13px] leading-5 font-medium text-foreground">Recent sign-ins</h3>
        <span className="text-[12px] leading-5 text-muted-foreground">Distances from {FROM?.label}</span>
      </div>
      <table className="mt-2 w-full border-collapse text-left">
        <thead>
          <tr className="text-[11.5px] leading-4 text-muted-foreground">
            <th scope="col" className="pb-1.5 font-normal">
              User
            </th>
            <th scope="col" className="w-[64px] pb-1.5 font-normal">
              UTC
            </th>
            <th scope="col" className="w-[98px] pb-1.5 font-normal">
              Location
            </th>
          </tr>
        </thead>
        <tbody>
          {SIGN_INS.map((signIn) => (
            <tr key={signIn.id} className="border-t border-border">
              <td className="max-w-0 py-[7px] pr-3">
                <span className="block truncate text-[13px] leading-5 text-foreground">{signIn.user}</span>
                <span className="block truncate text-[12px] leading-4 text-muted-foreground">{signIn.device}</span>
              </td>
              <td className="py-[7px] font-mono text-[12.5px] text-muted-foreground tabular-nums">{signIn.time}</td>
              <td className="py-[7px]">
                <GeoMiniMap location={signIn.location} from={FROM} tone={signIn.tone} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

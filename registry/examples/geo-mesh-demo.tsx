"use client";

import * as React from "react";

import { GeoMesh, type MeshDevice, type MeshPath, type MeshRelay } from "@/components/lumesec/geo-mesh";
import { distanceKm } from "@/lib/lumesec/geo";
import { demoLatency } from "@/lib/lumesec/geo-data";
import { useInView } from "@/lib/lumesec/motion";

const DEVICE: MeshDevice = { id: "laptop", label: "Work laptop", location: "Amsterdam", lat: 52.3676, lon: 4.9041 };

const PEERS: readonly MeshDevice[] = [
  { id: "build", label: "Build server", location: "Milan", lat: 45.4642, lon: 9.19 },
  { id: "nas", label: "NAS", location: "Dublin", lat: 53.3498, lon: -6.2603 },
  { id: "phone", label: "Phone", location: "Madrid", lat: 40.4168, lon: -3.7038 },
  { id: "desktop", label: "Desktop", location: "Toronto", lat: 43.6532, lon: -79.3832 },
  { id: "ci", label: "CI runner", location: "Chicago", lat: 41.8781, lon: -87.6298 },
  { id: "staging", label: "Staging server", location: "Helsinki", lat: 60.1699, lon: 24.9384 },
];

const RELAYS: readonly MeshRelay[] = [
  { id: "lhr", label: "London", lat: 51.5072, lon: -0.1276 },
  { id: "iad", label: "Ashburn", lat: 39.0438, lon: -77.4874 },
  { id: "waw", label: "Warsaw", lat: 52.2297, lon: 21.0122 },
];

const TRAFFIC: Readonly<Record<string, number>> = { build: 0.8, nas: 0.45, phone: 0.2, desktop: 0.35, ci: 0.65, staging: 0.3 };

/** The order the peers open direct paths in. The phone's network never allows one, so it stays relayed. */
const UPGRADES = ["desktop", "build", "staging", "ci", "nas"];
/** The direct peer that falls back to its relay for 3 s in each 14 s round. */
const FALLBACKS = ["ci", "build", "desktop", "staging", "nas"];
const FIRST_MS = 1500;
const STEP_MS = 1100;
const ROUND_MS = 14000;
const FALLBACK_MS = 3000;

/** A peer's home relay, the one nearest to it: its connections run through it until a direct path opens. */
function homeRelay(peer: MeshDevice) {
  return RELAYS.reduce((best, relay) => (distanceKm(peer, relay) < distanceKm(peer, best) ? relay : best));
}

function pathFor(peer: MeshDevice, direct: boolean): MeshPath {
  const traffic = TRAFFIC[peer.id];
  if (direct) return { peer: peer.id, relay: null, ms: demoLatency(DEVICE, peer), traffic };
  const relay = homeRelay(peer);
  return { peer: peer.id, relay: relay.id, ms: demoLatency(DEVICE, relay) + demoLatency(relay, peer) + 4, traffic };
}

/** The peers that are direct at a time in ms since the last reconnect. */
function directAt(time: number): ReadonlySet<string> {
  const direct = new Set(UPGRADES.filter((_, i) => time >= FIRST_MS + i * STEP_MS));
  const round = Math.floor(time / ROUND_MS);
  if (round >= 1 && time < round * ROUND_MS + FALLBACK_MS) direct.delete(FALLBACKS[(round - 1) % FALLBACKS.length]);
  return direct;
}

/** The next time after `time` at which a path changes. */
function nextChange(time: number) {
  const round = Math.floor(time / ROUND_MS);
  const events = [...UPGRADES.map((_, i) => FIRST_MS + i * STEP_MS), round * ROUND_MS + FALLBACK_MS, (round + 1) * ROUND_MS];
  return Math.min(...events.filter((event) => event > time));
}

export default function GeoMeshDemo() {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, "80px");
  // simulated connection events on a clock that pauses off screen
  const [time, setTime] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;
    const next = nextChange(time);
    const timer = window.setTimeout(() => setTime(next), next - time);
    return () => window.clearTimeout(timer);
  }, [inView, time]);

  const paths = React.useMemo(() => {
    const direct = directAt(time);
    return PEERS.map((peer) => pathFor(peer, direct.has(peer.id)));
  }, [time]);

  return (
    <div ref={rootRef} className="mx-auto grid w-full max-w-[660px] gap-3">
      <GeoMesh device={DEVICE} peers={PEERS} relays={RELAYS} paths={paths} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setTime(0)}
          className="h-[30px] cursor-pointer rounded-lg border border-border bg-card px-[11px] font-[inherit] text-[12.5px] font-medium text-foreground outline-none transition-colors hover:border-[color-mix(in_srgb,var(--lumesec)_50%,var(--border))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-lumesec motion-reduce:transition-none"
        >
          Reconnect all
        </button>
        <span className="ml-auto text-[12px] text-muted-foreground">Demo data</span>
      </div>
    </div>
  );
}

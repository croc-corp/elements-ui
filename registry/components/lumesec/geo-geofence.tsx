"use client";

import * as React from "react";

import { snapCenter, useCanvas, type CanvasSurface } from "@/lib/lumesec/canvas";
import { usePalette } from "@/lib/lumesec/color";
import {
  angleDelta,
  ARROW_DIRECTIONS,
  boundsOf,
  createDotBatch,
  createProjection,
  createScreenPoint,
  destinationPoint,
  distanceKm,
  EARTH_RADIUS_KM,
  fitBoundsToAspect,
  GEO_TOKENS,
  geodesicCircle,
  geoInk,
  initialBearing,
  isValidLatLon,
  mapLattice,
  pointAtDistance,
  projectPath,
  resampleArcLength,
  ringFront,
  spatialNavigate,
  wrapLongitude,
  type ArcLengthTable,
  type DotBatch,
  type DotLattice,
  type GeoBounds,
  type GeoInk,
  type LatLon,
  type MapProjection,
} from "@/lib/lumesec/geo";
import { createRandom, formatDistance, formatLatLon, formatNumber } from "@/lib/lumesec/geo-data";
import { clamp, easeOutCubic, hash, mixRgb, percent, rgba, smoothstep, type RGB } from "@/lib/lumesec/math";
import {
  prefersReducedMotion,
  springStep,
  useAnimationLoop,
  useLazyRef,
  useReducedMotion,
  type Spring,
} from "@/lib/lumesec/motion";
import { RollText } from "@/lib/lumesec/roll-text";
import { Sparks } from "@/lib/lumesec/sparks";
import { useControllableState } from "@/lib/lumesec/use-controllable-state";
import { cn } from "@/lib/utils";

/** An allowed zone: a true geodesic circle of `radiusKm` around `center`. */
export interface GeofenceZone {
  /** Stable id: the React key and what events refer to. */
  readonly id: string;
  /** Name shown on the map, in the zone list and in announcements. */
  readonly label: string;
  /** Centre in degrees. */
  readonly center: LatLon;
  /** Radius in kilometres, measured along the ground. */
  readonly radiusKm: number;
}

/** A tracked device at its last known position. */
export interface TrackedDevice {
  /** Stable id: the React key. */
  readonly id: string;
  /** Name shown in the device's chip and read by screen readers. Without it the id is used. */
  readonly label?: string;
  /** Latitude in degrees. */
  readonly lat: number;
  /** Longitude in degrees. */
  readonly lon: number;
}

/** A device that left every zone (`onBreach`) or came back into one (`onEnter`). */
export interface GeofenceEvent {
  /** The device, at the position where it crossed the fence. */
  readonly device: TrackedDevice;
  /** For a breach the zone the device left last; for an entry the zone it entered. */
  readonly zone: GeofenceZone;
  /** The point on the fence where the device crossed it. */
  readonly point: LatLon;
}

/** Props of GeoGeofence. The remaining props go to the root `<div>`. */
export interface GeoGeofenceProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The zones (controlled): `{ id, label, center, radiusKm }`. Use with `onZonesChange`. */
  zones?: readonly GeofenceZone[];
  /** The zones when uncontrolled. Default: two demo zones, Western Europe and East coast. */
  defaultZones?: readonly GeofenceZone[];
  /** Called with every zone when a drag ends or a key press moves or resizes a zone. */
  onZonesChange?: (zones: readonly GeofenceZone[]) => void;
  /** Called with every zone on each pointer move while a zone is dragged or resized. */
  onZonesInput?: (zones: readonly GeofenceZone[]) => void;
  /**
   * The tracked devices: `{ id, label?, lat, lon }`. When a position changes, the device glides there and is checked
   * against the zones on the way. Without it, six demo trackers walk slowly in and out of the zones. An empty array
   * shows no devices.
   */
  devices?: readonly TrackedDevice[];
  /** Shows the centre and radius handles, so zones can be moved and resized. */
  editable?: boolean;
  /** Smallest radius a drag or key press can set, in km. */
  minRadiusKm?: number;
  /** Largest radius a drag or key press can set, in km. */
  maxRadiusKm?: number;
  /** Called once each time a device leaves every zone, with the zone it left last. */
  onBreach?: (event: GeofenceEvent) => void;
  /** Called when a device that was outside every zone comes back into one. */
  onEnter?: (event: GeofenceEvent) => void;
  /**
   * The part of the world the map shows, as `{ west, south, east, north }` in degrees (`east` may exceed 180 across
   * the antimeridian). Widened to the map's aspect. Default: fitted around the zones, and fitted again when zones are
   * added or removed.
   */
  bounds?: GeoBounds;
  /** Accessible name of the map. */
  label?: string;
}

/**
 * Allowed zones as true geodesic circles on a flat map, with tracked devices inside them. Each zone is a disc of
 * tinted dots behind a dotted fence; drag its centre to move it and the handle on its edge to resize it, and the fence
 * follows elastically, dot by dot. The circle keeps its real shape, so it stretches toward the poles.
 *
 * When a device leaves every zone, the fence it crossed rings like a plucked string: two pulses run around the circle
 * from the crossing point in opposite directions and pass through each other on the far side, sparks fly off the
 * crossing and the device turns to the warning colour. Coming back in sends a soft ring through the dots.
 *
 * @example
 * <GeoGeofence
 *   zones={zones}
 *   onZonesChange={setZones}
 *   devices={vehicles}
 *   onBreach={({ device, zone }) => notify(`${device.label} left ${zone.label}`)}
 * />
 */
export function GeoGeofence({
  zones,
  defaultZones = DEMO_ZONES,
  onZonesChange,
  onZonesInput,
  devices,
  editable = true,
  minRadiusKm = 50,
  maxRadiusKm = 3000,
  onBreach,
  onEnter,
  bounds,
  label = "Geofence map",
  className,
  ...props
}: GeoGeofenceProps) {
  const [committed, setCommitted] = useControllableState<readonly GeofenceZone[]>({
    value: zones,
    defaultValue: defaultZones,
    onChange: onZonesChange,
  });
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  const [hotZone, setHotZone] = React.useState<string | null>(null);
  const [hoveredDevice, setHoveredDevice] = React.useState<string | null>(null);
  const [focusedDevice, setFocusedDevice] = React.useState<string | null>(null);
  const [activeDevice, setActiveDevice] = React.useState<string | null>(null);
  const [chipPlacement, setChipPlacement] = React.useState<ChipPlacement | null>(null);
  const [radiusFocus, setRadiusFocus] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState({ id: 0, text: "" });
  const [lastEvent, setLastEvent] = React.useState<{ text: string; kind: "breach" | "enter" } | null>(null);
  const reducedMotion = useReducedMotion();

  const minimum = Math.max(1, Number.isFinite(minRadiusKm) ? minRadiusKm : 50);
  const maximum = Math.max(minimum, Number.isFinite(maxRadiusKm) ? maxRadiusKm : 3000);
  const shownZones = sanitizeZones(draft?.zones ?? committed);

  // The fitted view follows the set of zones, not their positions: a drag never moves the map under the pointer.
  const zoneKey = shownZones.map((zone) => zone.id).join("\n");
  const [fitted, setFitted] = React.useState(() => ({ key: zoneKey, bounds: fitView(shownZones, devices ?? []) }));
  if (fitted.key !== zoneKey) setFitted({ key: zoneKey, bounds: fitView(shownZones, devices ?? []) });
  const view = normaliseView(bounds ?? fitted.bounds);
  const viewKey = boundsKey(view);

  // Demo trackers are placed once, around the zones the component starts with.
  const [fleet] = React.useState(() => createFleet(shownZones, view));
  const deviceList = devices ? sanitizeDevices(devices) : fleet.devices;

  const [statuses, setStatuses] = React.useState<Record<string, DeviceStatus>>(() =>
    computeStatuses(deviceList, shownZones),
  );

  // Pure layout: the server places handles and devices with a nominal 1000 px projection, the client with the measured
  // one. Percentages make both exact at any width.
  const width = size?.width ?? NOMINAL_WIDTH;
  const height = size?.height ?? NOMINAL_WIDTH / ASPECT;
  const layoutMap = createProjection("equirectangular", {
    width,
    height,
    lonRange: [view.west, view.east],
    latRange: [view.south, view.north],
  });
  const placedZones = shownZones.map((zone) => placeZone(zone, layoutMap));
  const placedDevices = deviceList.map((device) => placeDevice(device, layoutMap));
  const deviceStatus = (device: TrackedDevice) => statuses[device.id] ?? statusOf(device, shownZones);

  const outsideCount = deviceList.reduce((count, device) => count + (deviceStatus(device).inside ? 0 : 1), 0);
  const insideCounts = new Map<string, number>();
  for (const device of deviceList) {
    for (const id of deviceStatus(device).zones) insideCounts.set(id, (insideCounts.get(id) ?? 0) + 1);
  }
  const deviceIds = new Set(deviceList.map((device) => device.id));
  const tabStop = activeDevice !== null && deviceIds.has(activeDevice) ? activeDevice : (deviceList[0]?.id ?? null);
  const chipDevice = hoveredDevice ?? focusedDevice;
  const zoneById = new Map(shownZones.map((zone) => [zone.id, zone]));

  const stageRef = React.useRef<HTMLDivElement>(null);
  const baseRef = React.useRef<HTMLCanvasElement>(null);
  const liveRef = React.useRef<HTMLCanvasElement>(null);
  const effectsRef = React.useRef<HTMLCanvasElement>(null);
  /** The mutable drawing state, created on first use (never during render). */
  const engineRef = useLazyRef(createEngine);
  const configRef = React.useRef<Config | null>(null);
  const dragRef = React.useRef<DragSession | null>(null);
  const deviceRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>());

  // The drawing code reads the latest props from here. Declared before the canvases so it runs first.
  React.useEffect(() => {
    configRef.current = {
      zones: shownZones,
      devices: devices ? deviceList : null,
      fleet,
      view,
      hot: draft?.id ?? hotZone,
      drag: draft ? { id: draft.id, kind: draft.kind } : null,
    };
  });

  const loop = useAnimationLoop(stageRef, step);
  const palette = usePalette(stageRef, GEO_TOKENS, () => {
    engineRef.current.inkDirty = true;
    loop.kick();
  });
  const base = useCanvas(
    baseRef,
    (surface) => {
      const engine = engineRef.current;
      rebuild(engine, configRef.current, surface.width, surface.height);
      // a resized backing store comes back empty, even when the projection did not change
      engine.baseDirty = true;
      setSize((previous) =>
        previous && previous.width === surface.width && previous.height === surface.height
          ? previous
          : { width: surface.width, height: surface.height },
      );
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const live = useCanvas(
    liveRef,
    () => {
      engineRef.current.liveDirty = true;
      loop.kick();
    },
    { maxDpr: 2 },
  );
  const effects = useCanvas(
    effectsRef,
    (surface) => {
      const engine = engineRef.current;
      engine.fxOffsetX = -surface.canvas.offsetLeft;
      engine.fxOffsetY = -surface.canvas.offsetTop;
    },
    { maxDpr: 2 },
  );

  // A new view (other zones, or `bounds`) rebuilds the projection and the lattice.
  React.useEffect(() => {
    const engine = engineRef.current;
    if (engine.width && engine.height) rebuild(engine, configRef.current, engine.width, engine.height);
    loop.kick();
  }, [viewKey, engineRef, loop]);

  // Zones, devices and emphasis reach the loop on its next frame.
  React.useEffect(() => {
    loop.kick();
  }, [shownZones, devices, hotZone, draft, reducedMotion, loop]);

  // Device buttons sit at their rendered position; the loop moves them from there with a transform. Re-sync right
  // after every render, before paint, so a new rendered position never flashes.
  React.useLayoutEffect(() => {
    const engine = engineRef.current;
    engine.deviceBases.clear();
    for (const placed of placedDevices) engine.deviceBases.set(placed.device.id, placed);
    writeDevices(engine, deviceRefs.current);
  });

  function step(time: number, delta: number) {
    const engine = engineRef.current;
    const config = configRef.current;
    if (!config) return false;
    if (engine.inkDirty && palette.current) {
      engine.ink = geoInk(palette.current);
      applyInk(engine, engine.ink);
      engine.inkDirty = false;
      engine.baseDirty = true;
      engine.liveDirty = true;
    }
    const liveSurface = live.current;
    const map = engine.projection;
    if (!liveSurface || !map || !engine.ink || !engine.cells || !engine.lattice) return false;
    const baseSurface = base.current;
    if (engine.baseDirty && baseSurface) {
      bakeLand(baseSurface, engine.lattice, engine.ink.land);
      engine.baseDirty = false;
    }
    const reduced = prefersReducedMotion();

    syncZones(engine, config.zones, reduced);
    const devicesBusy = stepDevices(engine, config, time, delta, reduced);
    writeDevices(engine, deviceRefs.current);
    const events = checkContainment(engine, config.zones);
    for (const event of events) fireEvent(engine, event, time, reduced);
    const zonesBusy = stepZones(engine, config, time, delta, reduced);
    if (zonesBusy || engine.liveDirty || engine.pings.length) {
      drawLive(engine, liveSurface, time, reduced);
      engine.liveDirty = false;
    }

    let sparksBusy = false;
    const fx = effects.current;
    if (fx) {
      if (engine.sparks.active) {
        fx.context.clearRect(0, 0, fx.width, fx.height);
        sparksBusy = engine.sparks.step(fx.context, delta);
        engine.fxDirty = true;
      } else if (engine.fxDirty) {
        fx.context.clearRect(0, 0, fx.width, fx.height);
        engine.fxDirty = false;
      }
    }
    publish(engine, events, config.zones);
    return devicesBusy || zonesBusy || sparksBusy || engine.pings.length > 0;
  }

  /** Sends status changes and events to React, the callbacks and screen readers. */
  function publish(engine: Engine, events: readonly InternalEvent[], current: readonly GeofenceZone[]) {
    let signature = "";
    for (const device of engine.devices.values()) signature += `${device.id}:${device.zones.join(",")};`;
    if (signature !== engine.published) {
      engine.published = signature;
      const next: Record<string, DeviceStatus> = {};
      for (const device of engine.devices.values()) next[device.id] = { inside: device.inside, zones: device.zones };
      setStatuses(next);
    }
    for (const event of events) {
      const zone = current.find((entry) => entry.id === event.zoneId);
      const runtime = engine.devices.get(event.deviceId);
      if (!zone || !runtime) continue;
      const device: TrackedDevice = {
        id: runtime.id,
        label: runtime.label,
        lat: runtime.lat,
        lon: wrapLongitude(runtime.lon),
      };
      const payload: GeofenceEvent = { device, zone, point: event.point };
      if (event.kind === "breach") {
        const text = `${runtime.label} left ${zone.label}`;
        setAnnouncement((previous) => ({ id: previous.id + 1, text }));
        setLastEvent({ text, kind: "breach" });
        ringDevice(deviceRefs.current.get(runtime.id));
        flashRow(rowRefs.current.get(zone.id));
        onBreach?.(payload);
      } else {
        setLastEvent({ text: `${runtime.label} is back in ${zone.label}`, kind: "enter" });
        popDevice(deviceRefs.current.get(runtime.id));
        onEnter?.(payload);
      }
    }
  }

  /* Editing ------------------------------------------------------------------------------------------- */

  /** Pointer position in map px, clamped to the map, and the projection that maps it. */
  function pointerOnMap(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const engine = engineRef.current;
    const map =
      engine.projection && engine.width === rect.width && engine.height === rect.height
        ? engine.projection
        : createProjection("equirectangular", {
            width: rect.width,
            height: rect.height,
            lonRange: [view.west, view.east],
            latRange: [view.south, view.north],
          });
    return { x: clientX - rect.left, y: clientY - rect.top, width: rect.width, height: rect.height, map };
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, zone: GeofenceZone, kind: DragKind) {
    if (event.button !== 0 || !editable) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    const pointer = pointerOnMap(event.clientX, event.clientY);
    if (!pointer) return;
    const point = createScreenPoint();
    pointer.map.project(zone.center.lat, zone.center.lon, point);
    let radiusOffset = 0;
    if (kind === "radius") {
      const under = pointer.map.invert(clamp(pointer.x, 0, pointer.width), clamp(pointer.y, 0, pointer.height));
      if (under) radiusOffset = effectiveRadius(zone) - distanceKm(zone.center, under);
    }
    dragRef.current = {
      id: zone.id,
      kind,
      pointerId: event.pointerId,
      offsetX: pointer.x - point.x,
      offsetY: pointer.y - point.y,
      radiusOffset,
      startRadius: zone.radiusKm,
      base: shownZones,
      zones: shownZones,
      moved: false,
    };
    setDraft({ id: zone.id, kind, zones: shownZones });
    loop.kick();
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const pointer = pointerOnMap(event.clientX, event.clientY);
    if (!pointer) return;
    const zone = session.zones.find((entry) => entry.id === session.id);
    if (!zone) return;
    let next: GeofenceZone | null = null;
    if (session.kind === "center") {
      const x = clamp(pointer.x - session.offsetX, 0, pointer.width);
      const y = clamp(pointer.y - session.offsetY, 0, pointer.height);
      const center = pointer.map.invert(x, y);
      if (center) {
        const radiusKm = Math.min(session.startRadius, poleCap(center.lat));
        next = { ...zone, center: { lat: center.lat, lon: wrapLongitude(center.lon) }, radiusKm };
      }
    } else {
      const under = pointer.map.invert(clamp(pointer.x, 0, pointer.width), clamp(pointer.y, 0, pointer.height));
      if (under) {
        const raw = distanceKm(zone.center, under) + session.radiusOffset;
        const radiusKm = Math.min(clamp(Math.round(raw / 5) * 5, minimum, maximum), poleCap(zone.center.lat));
        next = { ...zone, radiusKm };
      }
    }
    if (!next || sameZone(next, zone)) return;
    const updated = next;
    session.zones = session.zones.map((entry) => (entry.id === updated.id ? updated : entry));
    session.moved = true;
    setDraft({ id: session.id, kind: session.kind, zones: session.zones });
    onZonesInput?.(session.zones);
    loop.kick();
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const element = event.currentTarget;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    setDraft(null);
    if (session.moved && !sameZones(session.zones, session.base)) setCommitted(session.zones);
    loop.kick();
  }

  /** Commits a key press: replaces one zone and reports every zone. */
  function commitZone(next: GeofenceZone) {
    setCommitted((previous) => sanitizeZones(previous).map((entry) => (entry.id === next.id ? next : entry)));
    loop.kick();
  }

  function handleCenterKey(event: React.KeyboardEvent<HTMLButtonElement>, zone: GeofenceZone) {
    const stepDeg = event.shiftKey ? 5 : 0.5;
    let lat = zone.center.lat;
    let lon = zone.center.lon;
    if (event.key === "ArrowUp") lat += stepDeg;
    else if (event.key === "ArrowDown") lat -= stepDeg;
    else if (event.key === "ArrowRight") lon += stepDeg;
    else if (event.key === "ArrowLeft") lon -= stepDeg;
    else return;
    event.preventDefault();
    if (!editable) return;
    // keep the centre on the map: latitude inside the crop, longitude inside the view's span
    lat = clamp(lat, Math.max(-89, view.south), Math.min(89, view.north));
    const west = view.west;
    const east = view.east;
    let relative = lon;
    while (relative < west) relative += 360;
    while (relative > west + 360) relative -= 360;
    if (east - west < 360) relative = clamp(relative, west, east);
    commitZone({
      ...zone,
      center: { lat, lon: wrapLongitude(relative) },
      radiusKm: Math.min(zone.radiusKm, poleCap(lat)),
    });
  }

  function handleRadiusKey(event: React.KeyboardEvent<HTMLDivElement>, zone: GeofenceZone) {
    const current = effectiveRadius(zone);
    const big = event.shiftKey ? 250 : 25;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + big;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = current - big;
        break;
      case "PageUp":
        next = current + 250;
        break;
      case "PageDown":
        next = current - 250;
        break;
      case "Home":
        next = minimum;
        break;
      case "End":
        next = maximum;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (!editable) return;
    const radiusKm = Math.min(clamp(Math.round(next), minimum, maximum), poleCap(zone.center.lat));
    if (radiusKm !== zone.radiusKm) commitZone({ ...zone, radiusKm });
  }

  /* Devices ------------------------------------------------------------------------------------------- */

  function focusDevice(id: string) {
    setActiveDevice(id);
    deviceRefs.current.get(id)?.focus();
  }

  /** Opens a device's chip on the side with room, judged from where the device is drawn now (it may have walked). */
  function placeChip(id: string) {
    const engine = engineRef.current;
    const runtime = engine.devices.get(id);
    if (!runtime || !engine.width) return;
    setChipPlacement({ id, ...chipSide(runtime.x, runtime.y, engine.width) });
  }

  function handleDeviceKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      // the devices move, so navigate by where they are drawn now
      const engine = engineRef.current;
      const points = deviceList.map((device) => {
        const runtime = engine.devices.get(device.id);
        const placed = placedDevices.find((entry) => entry.device.id === device.id);
        return runtime
          ? { x: runtime.x, y: runtime.y }
          : { x: (placed?.left ?? 0) * width, y: (placed?.top ?? 0) * height };
      });
      const next = spatialNavigate(points, index, direction);
      if (next !== index) focusDevice(deviceList[next].id);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = deviceList[event.key === "Home" ? 0 : deviceList.length - 1];
      if (target) focusDevice(target.id);
    }
  }

  /* Render -------------------------------------------------------------------------------------------- */

  /** "inside Western Europe" or "outside every zone", for names and chips. */
  const deviceStateText = (device: TrackedDevice) => {
    const status = deviceStatus(device);
    if (!status.inside) return "outside every zone";
    return `inside ${status.zones.map((id) => zoneById.get(id)?.label ?? id).join(" and ")}`;
  };
  const statusLabel = (device: TrackedDevice) => {
    const text = deviceStateText(device);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <div
      data-slot="geo-geofence"
      className={cn(
        "grid w-full max-w-[660px] gap-3 text-foreground [-webkit-tap-highlight-color:transparent]",
        className,
      )}
      {...props}
    >
      <div className="relative select-none" style={{ aspectRatio: ASPECT }}>
        <div ref={stageRef} role="group" aria-roledescription="map" aria-label={label} className="absolute inset-0">
          <div className="absolute inset-0 overflow-hidden rounded-xl bg-card">
            <canvas ref={baseRef} aria-hidden="true" className="absolute inset-0 block size-full" />
            <canvas ref={liveRef} aria-hidden="true" className="absolute inset-0 block size-full" />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl border border-border" />
          <canvas
            ref={effectsRef}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-3 -inset-y-8 z-[4] block h-[calc(100%+64px)] w-[calc(100%+24px)] sm:-inset-x-10 sm:w-[calc(100%+80px)]"
          />
          <div className="absolute inset-0">
            {placedZones.map((placed) => (
              <span
                key={placed.zone.id}
                aria-hidden="true"
                data-hot={(draft?.id ?? hotZone) === placed.zone.id ? "" : undefined}
                className={cn(
                  "pointer-events-none absolute z-[1] -translate-x-1/2 text-[11px] leading-[14px] font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 [text-shadow:0_0_3px_var(--card),0_0_2px_var(--card),0_0_1px_var(--card)] data-[hot]:text-foreground",
                  placed.labelBelow ? "mt-1.5" : "-mt-1.5 -translate-y-full",
                )}
                style={{ left: percent(placed.labelLeft), top: percent(placed.labelTop) }}
              >
                {placed.zone.label}
              </span>
            ))}
            {editable &&
              placedZones.map((placed) => {
                const { zone } = placed;
                const dragging = draft?.id === zone.id ? draft.kind : null;
                const radius = Math.round(effectiveRadius(zone));
                const showReadout = dragging === "radius" || radiusFocus === zone.id;
                return (
                  <React.Fragment key={zone.id}>
                    <button
                      type="button"
                      data-slot="geo-geofence-center"
                      data-dragging={dragging === "center" ? "" : undefined}
                      aria-roledescription="zone centre"
                      aria-label={`${zone.label}, ${formatLatLon(zone.center, "decimal", 1)}`}
                      onPointerDown={(event) => startDrag(event, zone, "center")}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => handleCenterKey(event, zone)}
                      onFocus={() => setHotZone(zone.id)}
                      onBlur={() => setHotZone((current) => (current === zone.id ? null : current))}
                      onPointerEnter={() => setHotZone(zone.id)}
                      onPointerLeave={() => setHotZone((current) => (current === zone.id ? null : current))}
                      className="group/center absolute z-[3] -mt-[7px] -ml-[7px] grid size-[14px] cursor-grab touch-none place-items-center rounded-full border-0 bg-transparent p-0 outline-none before:absolute before:-inset-2 before:rounded-full before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid data-[dragging]:cursor-grabbing"
                      style={{ left: percent(placed.centerLeft), top: percent(placed.centerTop) }}
                    >
                      <span className="col-start-1 row-start-1 block size-[14px] rounded-full bg-lumesec shadow-[0_0_0_2px_var(--card),0_1px_4px_rgb(0_0_0/0.3)] transition-[scale] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/center:scale-110 group-data-[dragging]/center:scale-90 motion-reduce:transition-none" />
                      <span className="col-start-1 row-start-1 block size-1 rounded-full bg-lumesec-foreground" />
                    </button>
                    <div
                      role="slider"
                      tabIndex={0}
                      data-slot="geo-geofence-radius"
                      data-dragging={dragging === "radius" ? "" : undefined}
                      aria-label={`Radius of ${zone.label}`}
                      aria-orientation="horizontal"
                      aria-valuemin={minimum}
                      aria-valuemax={maximum}
                      aria-valuenow={radius}
                      aria-valuetext={`${formatNumber(radius)} kilometres`}
                      onPointerDown={(event) => startDrag(event, zone, "radius")}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(event) => handleRadiusKey(event, zone)}
                      onFocus={(event) => {
                        setHotZone(zone.id);
                        if (event.currentTarget.matches(":focus-visible")) setRadiusFocus(zone.id);
                      }}
                      onBlur={() => {
                        setHotZone((current) => (current === zone.id ? null : current));
                        setRadiusFocus((current) => (current === zone.id ? null : current));
                      }}
                      onPointerEnter={() => setHotZone(zone.id)}
                      onPointerLeave={() => setHotZone((current) => (current === zone.id ? null : current))}
                      className="group/radius absolute z-[3] -mt-1.5 -ml-1.5 grid size-3 cursor-ew-resize touch-none place-items-center rounded-full outline-none before:absolute before:-inset-[9px] before:rounded-full before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lumesec focus-visible:outline-solid"
                      style={{ left: percent(placed.handleLeft), top: percent(placed.handleTop) }}
                    >
                      <span className="block size-3 rounded-full border-[1.5px] border-lumesec bg-card shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-[scale] duration-150 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/radius:scale-115 group-data-[dragging]/radius:scale-90 motion-reduce:transition-none" />
                      <span
                        aria-hidden="true"
                        data-visible={showReadout ? "" : undefined}
                        className={cn(
                          "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md border border-border bg-card/95 px-1.5 py-0.5 font-mono text-[11px] leading-4 whitespace-nowrap text-foreground tabular-nums opacity-0 shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)] transition-opacity duration-150 data-[visible]:opacity-100 motion-reduce:transition-none",
                          placed.handleWest ? "right-[calc(100%+8px)]" : "left-[calc(100%+8px)]",
                        )}
                      >
                        {formatDistance(radius)}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            {placedDevices.map((placed, index) => {
              const { device } = placed;
              const status = deviceStatus(device);
              const name = device.label ?? device.id;
              const showChip = chipDevice === device.id;
              const chip =
                chipPlacement && chipPlacement.id === device.id
                  ? chipPlacement
                  : chipSide(placed.left * width, placed.top * height, width);
              return (
                <button
                  key={device.id}
                  ref={(node) => {
                    if (node) deviceRefs.current.set(device.id, node);
                    else deviceRefs.current.delete(device.id);
                  }}
                  type="button"
                  data-slot="geo-geofence-device"
                  data-state={status.inside ? "inside" : "outside"}
                  aria-label={`${name}, ${deviceStateText(device)}`}
                  tabIndex={device.id === tabStop ? 0 : -1}
                  onKeyDown={(event) => handleDeviceKey(event, index)}
                  onFocus={(event) => {
                    setActiveDevice(device.id);
                    if (!event.currentTarget.matches(":focus-visible")) return;
                    placeChip(device.id);
                    setFocusedDevice(device.id);
                  }}
                  onBlur={() => setFocusedDevice((current) => (current === device.id ? null : current))}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "mouse") return;
                    placeChip(device.id);
                    setHoveredDevice(device.id);
                  }}
                  onPointerLeave={() => setHoveredDevice((current) => (current === device.id ? null : current))}
                  className={cn(
                    "group/device absolute z-[2] -mt-2.5 -ml-2.5 grid size-5 cursor-default place-items-center rounded-full border-0 bg-transparent p-0 will-change-transform outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-lumesec focus-visible:outline-solid",
                    showChip && "z-[5]",
                  )}
                  style={{ left: percent(placed.left), top: percent(placed.top) }}
                >
                  {RING_DELAYS.map((delay) => (
                    <span
                      key={delay}
                      data-ring=""
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-[5px] rounded-full border-[1.5px] border-lumesec-warning opacity-0"
                    />
                  ))}
                  <span
                    data-dot=""
                    aria-hidden="true"
                    className="block size-2 rounded-full bg-lumesec-success shadow-[0_0_0_1.5px_var(--card)] transition-[background-color,scale] duration-200 group-hover/device:scale-125 group-data-[state=outside]/device:bg-lumesec-warning motion-reduce:transition-none"
                  />
                  <span
                    aria-hidden="true"
                    data-visible={showChip ? "" : undefined}
                    className={cn(
                      "pointer-events-none absolute flex w-max flex-col rounded-md border border-border bg-card/95 px-2 py-1 text-left opacity-0 shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)] backdrop-blur-[2px] transition-opacity duration-150 data-[visible]:opacity-100 motion-reduce:transition-none",
                      chip.below ? "top-[calc(100%+2px)]" : "bottom-[calc(100%+2px)]",
                      chip.align === "start"
                        ? "left-0"
                        : chip.align === "end"
                          ? "right-0"
                          : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <span className="text-[12px] leading-4 font-medium text-foreground">{name}</span>
                    <span
                      className={cn(
                        "text-[11px] leading-4",
                        status.inside ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {statusLabel(device)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <StatusLine
        total={deviceList.length}
        outside={outsideCount}
        hasZones={shownZones.length > 0}
        lastEvent={lastEvent}
        animate={!reducedMotion}
      />

      <table className="w-full table-fixed border-collapse text-[13px] leading-5">
        <caption className="sr-only">Zones</caption>
        <thead>
          <tr className="border-b border-border text-[11.5px] leading-4 text-muted-foreground">
            <th scope="col" className="h-7 pr-3 text-left font-normal">
              Zone
            </th>
            <th scope="col" className="h-7 w-[92px] px-3 text-right font-normal">
              Radius
            </th>
            <th scope="col" className="h-7 w-[64px] pl-3 text-right font-normal">
              Inside
            </th>
          </tr>
        </thead>
        <tbody>
          {shownZones.length === 0 && (
            <tr>
              <td colSpan={3} className="h-9 text-[12.5px] text-muted-foreground">
                No zones
              </td>
            </tr>
          )}
          {shownZones.map((zone) => (
            <ZoneRow
              key={zone.id}
              ref={(node) => {
                if (node) rowRefs.current.set(zone.id, node);
                else rowRefs.current.delete(zone.id);
              }}
              zone={zone}
              inside={insideCounts.get(zone.id) ?? 0}
              hot={(draft?.id ?? hotZone) === zone.id}
              animate={!reducedMotion && draft?.id !== zone.id}
              onHover={(hovered) => setHotZone((current) => (hovered ? zone.id : current === zone.id ? null : current))}
            />
          ))}
        </tbody>
      </table>

      {/* polite: the demo fleet breaches every few seconds, which must not interrupt the reader */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement.text && <p key={announcement.id}>{announcement.text}</p>}
      </div>
    </div>
  );
}

/* Status line and zone list ------------------------------------------------------------------------ */

/** Tracks which way a number changed, so its figures roll up when it grows and down when it shrinks. */
function useRollDirection(value: number) {
  const [state, setState] = React.useState({ value, direction: 1 });
  if (state.value !== value) setState({ value, direction: value >= state.value ? 1 : -1 });
  return state.direction;
}

/** "All 6 devices inside" or "1 device outside" on the left, the latest breach or return on the right. */
function StatusLine({
  total,
  outside,
  hasZones,
  lastEvent,
  animate,
}: {
  total: number;
  outside: number;
  hasZones: boolean;
  lastEvent: { text: string; kind: "breach" | "enter" } | null;
  animate: boolean;
}) {
  const insideDirection = useRollDirection(total);
  const outsideDirection = useRollDirection(outside);
  const alert = outside > 0;
  let text: React.ReactNode;
  if (total === 0) {
    text = "No devices";
  } else if (!alert) {
    text = (
      <>
        {total > 1 && "All "}
        <RollText
          text={formatNumber(total)}
          direction={insideDirection}
          animate={animate}
          className="font-mono tabular-nums"
        />{" "}
        {total === 1 ? "device" : "devices"} inside
      </>
    );
  } else {
    text = (
      <>
        <RollText
          text={formatNumber(outside)}
          direction={outsideDirection}
          animate={animate}
          className="font-mono tabular-nums"
        />{" "}
        {outside === 1 ? "device" : "devices"} outside{!hasZones && ", no zones"}
      </>
    );
  }
  return (
    <div className="flex min-h-6 min-w-0 items-center justify-between gap-3 text-[12.5px] leading-5">
      <p
        data-alert={alert ? "" : undefined}
        className="m-0 -ml-0.5 flex shrink-0 items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 transition-colors duration-200 data-[alert]:bg-lumesec-warning/12 data-[alert]:pl-2 motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", alert ? "bg-lumesec-warning" : "bg-lumesec-success")}
        />
        <span className="whitespace-nowrap">{text}</span>
      </p>
      {lastEvent && (
        <p className="m-0 flex min-w-0 items-center justify-end gap-1.5 overflow-hidden text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              lastEvent.kind === "breach" ? "bg-lumesec-warning" : "bg-lumesec-success",
            )}
          />
          <RollText text={lastEvent.text} animate={animate} className="min-w-0 truncate" />
        </p>
      )}
    </div>
  );
}

/** One zone in the list: its name, its radius and how many devices are inside, both rolling as they change. */
function ZoneRow({
  zone,
  inside,
  hot,
  animate,
  onHover,
  ref,
}: {
  zone: GeofenceZone;
  inside: number;
  hot: boolean;
  animate: boolean;
  onHover: (hovered: boolean) => void;
  ref: React.Ref<HTMLTableRowElement>;
}) {
  const radius = Math.round(effectiveRadius(zone));
  const radiusDirection = useRollDirection(radius);
  const insideDirection = useRollDirection(inside);
  return (
    <tr
      ref={ref}
      data-hot={hot ? "" : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onHover(true);
      }}
      onPointerLeave={() => onHover(false)}
      className="border-b border-border/70 transition-colors duration-150 last:border-b-0 data-[hot]:bg-muted/50 motion-reduce:transition-none"
    >
      <td className="h-9 pr-3">
        <span className="flex min-w-0 items-center gap-2">
          <FenceGlyph />
          <span className="truncate font-medium">{zone.label}</span>
        </span>
      </td>
      <td className="h-9 px-3 text-right font-mono text-[12.5px] tabular-nums">
        <RollText
          text={formatDistance(radius)}
          direction={radiusDirection}
          animate={animate}
          className="justify-items-end"
        />
      </td>
      <td className="h-9 pl-3 text-right font-mono text-[12.5px] tabular-nums">
        <RollText
          text={formatNumber(inside)}
          direction={insideDirection}
          animate={animate}
          className="justify-items-end"
        />
      </td>
    </tr>
  );
}

/** A dotted ring, the fence in miniature. */
function FenceGlyph() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5 shrink-0 overflow-visible text-lumesec">
      <circle cx="7" cy="7" r="5.25" fill="currentColor" fillOpacity={0.12} stroke="none" />
      <circle
        cx="7"
        cy="7"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray="0.01 2.75"
      />
    </svg>
  );
}

/* WAAPI one-shots ------------------------------------------------------------------------------------- */

const RING_DELAYS = [0, 140] as const;

/** Two warning rings run out of a device that just left its zone, and its dot pops. */
function ringDevice(element: HTMLElement | undefined) {
  if (!element || prefersReducedMotion() || typeof element.animate !== "function") return;
  element.querySelectorAll("[data-ring]").forEach((ring, i) => {
    ring.animate(
      [
        { opacity: 0.95, transform: "scale(1)" },
        { opacity: 0, transform: "scale(3.6)" },
      ],
      { duration: 760 + i * 160, delay: RING_DELAYS[i] ?? 0, easing: "cubic-bezier(.1,.75,.3,1)" },
    );
  });
  element.querySelector("[data-dot]")?.animate(POP_KEYFRAMES, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** A device that came back in pops once; the lattice ring around it does the rest. */
function popDevice(element: HTMLElement | undefined) {
  if (!element || prefersReducedMotion() || typeof element.animate !== "function") return;
  element.querySelector("[data-dot]")?.animate(POP_KEYFRAMES, { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** The zone's row glows in the warning colour and fades back. */
function flashRow(element: HTMLElement | undefined) {
  if (!element || typeof element.animate !== "function") return;
  const reduced = prefersReducedMotion();
  element.animate(
    [
      { backgroundColor: "color-mix(in srgb, var(--lumesec-warning) 16%, transparent)" },
      { backgroundColor: "color-mix(in srgb, var(--lumesec-warning) 0%, transparent)" },
    ],
    { duration: reduced ? 1000 : 1400, easing: reduced ? "steps(1, end)" : "cubic-bezier(.2,.8,.2,1)" },
  );
}

const POP_KEYFRAMES: Keyframe[] = [
  { scale: "1" },
  { scale: "1.75", offset: 0.3 },
  { scale: "0.9", offset: 0.65 },
  { scale: "1" },
];

/* Constants ------------------------------------------------------------------------------------------ */

/** Width / height of the map. The fitted view is widened to it, so the projection fills the box exactly. */
const ASPECT = 2.4;
/** Width the server lays out handles and devices at. */
const NOMINAL_WIDTH = 1000;
/** Land lattice pitch in px. */
const PITCH = 4;
/** Samples of each geodesic circle (bearing steps). */
const RING_STEPS = 128;
/** Spacing of the fence dots along the circle, in px. */
const FENCE_SPACING = 4;
const LAND_DOT = 1.5;
const FENCE_DOT = 2;
const FENCE_DOT_HOT = 2.5;
/** Fence springs: the slightly under-damped snap every component uses. */
const STIFFNESS = 520;
const DAMPING = 0.72;
/** The pluck: Gaussian pulses of this width (px) and amplitude (px), running at SPEED px/s, decaying over DECAY s. */
const PLUCK_SIGMA = 10;
const PLUCK_AMPLITUDE = 5;
const PLUCK_SPEED = 220;
const PLUCK_DECAY = 0.7;
const PLUCK_SECONDS = 1.2;
/** Reduced motion: the crossed section of the fence turns warning for this long, this far either side (px). */
const FLASH_SECONDS = 1;
const FLASH_REACH = 26;
/** Re-entry ring through the lattice. */
const PING_SECONDS = 0.8;
const PING_REACH = 30;
/** Reveal of a new zone: the fence draws itself from the north point, then the dots fill outward. */
const FENCE_GROW_SECONDS = 0.8;
const FILL_DELAY = 0.18;
const FILL_SECONDS = 1.05;
const GROW_BAND = 0.09;
/** Rim glow of the interior, in px from the fence. */
const RIM_PX = 11;
/** Share of the sea positions inside a zone that carry a dot. */
const SEA_DENSITY = 0.62;
/** Device glide to a new position (critically damped). */
const GLIDE_STIFFNESS = 90;
/** Mean Earth km per degree of arc. */
const KM_PER_DEGREE = (Math.PI / 180) * EARTH_RADIUS_KM;

const SPARK_OPTIONS = {
  speed: [50, 200],
  life: [0.35, 0.8],
  size: [1.5, 2.5],
  spread: 1.5,
  drag: 3.2,
  jitter: 2,
} as const;

const WORLD: GeoBounds = { west: -180, south: -60, east: 180, north: 75 };

const DEMO_ZONES: readonly GeofenceZone[] = [
  { id: "western-europe", label: "Western Europe", center: { lat: 48.8566, lon: 2.3522 }, radiusKm: 1200 },
  { id: "east-coast", label: "East coast", center: { lat: 40.7128, lon: -74.006 }, radiusKm: 900 },
];

/* Pure helpers -------------------------------------------------------------------------------------- */

/** The largest radius (km) a circle around `lat` can have without containing a pole. */
function poleCap(lat: number) {
  return Math.max(1, (90 - Math.abs(lat)) * KM_PER_DEGREE * 0.995);
}

/** The radius drawn and checked: the zone's radius, capped so the circle never contains a pole. */
function effectiveRadius(zone: GeofenceZone) {
  return Math.max(1, Math.min(zone.radiusKm, poleCap(zone.center.lat)));
}

const validZone = (zone: GeofenceZone) =>
  isValidLatLon(zone.center) && Number.isFinite(zone.radiusKm) && zone.radiusKm > 0;

/** Drops zones with a repeated id or invalid numbers. Returns the input when it is already clean. */
function sanitizeZones(list: readonly GeofenceZone[]): readonly GeofenceZone[] {
  const seen = new Set<string>();
  let clean = true;
  for (const zone of list) {
    if (seen.has(zone.id) || !validZone(zone)) clean = false;
    seen.add(zone.id);
  }
  if (clean) return list;
  const kept = new Set<string>();
  return list.filter((zone) => {
    if (kept.has(zone.id) || !validZone(zone)) return false;
    kept.add(zone.id);
    return true;
  });
}

/** Drops devices with a repeated id or a position off the globe. */
function sanitizeDevices(list: readonly TrackedDevice[]): readonly TrackedDevice[] {
  const seen = new Set<string>();
  return list.filter((device) => {
    if (seen.has(device.id) || !isValidLatLon(device)) return false;
    seen.add(device.id);
    return true;
  });
}

function sameZone(a: GeofenceZone, b: GeofenceZone) {
  return a.center.lat === b.center.lat && a.center.lon === b.center.lon && a.radiusKm === b.radiusKm;
}

function sameZones(a: readonly GeofenceZone[], b: readonly GeofenceZone[]) {
  return a.length === b.length && a.every((zone, i) => zone.id === b[i].id && sameZone(zone, b[i]));
}

/** The view around the zones (their full circles), or the devices, or the world. */
function fitView(zones: readonly GeofenceZone[], devices: readonly TrackedDevice[]): GeoBounds {
  const points: LatLon[] = [];
  for (const zone of zones) points.push(...geodesicCircle(zone.center, effectiveRadius(zone), 24));
  if (points.length === 0)
    for (const device of devices) if (Number.isFinite(device.lat) && Number.isFinite(device.lon)) points.push(device);
  if (points.length === 0) return WORLD;
  return boundsOf(points, 0.14, 24);
}

/** A view widened to the map's aspect, so the equirectangular projection fills the box. */
function normaliseView(view: GeoBounds): GeoBounds {
  const south = clamp(Math.min(view.south, view.north), -89, 89);
  const north = clamp(Math.max(view.south, view.north), -89, 89);
  let east = view.east;
  if (east <= view.west) east += 360;
  const fitted = fitBoundsToAspect(
    { west: view.west, south, east: Math.min(east, view.west + 360), north },
    ASPECT,
    "equirectangular",
  );
  return fitted;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const boundsKey = (view: GeoBounds) => [view.west, view.south, view.east, view.north].map(round3).join(",");

/** Where a zone's handles and label go, as shares (0 to 1) of the map's width and height. */
interface PlacedZone {
  zone: GeofenceZone;
  centerLeft: number;
  centerTop: number;
  handleLeft: number;
  handleTop: number;
  /** The radius handle sits on the west point because the east point is off the map. */
  handleWest: boolean;
  labelLeft: number;
  labelTop: number;
  labelBelow: boolean;
}

/** Projects a point on a zone's circle on the same side of the seam as the zone's centre. */
function projectNear(map: MapProjection, point: LatLon, centerX: number, out: { x: number; y: number; z: number }) {
  map.project(point.lat, point.lon, out);
  const turn = map.scale * Math.PI * 2;
  if (out.x - centerX > turn / 2) out.x -= turn;
  else if (centerX - out.x > turn / 2) out.x += turn;
}

function placeZone(zone: GeofenceZone, map: MapProjection): PlacedZone {
  const { width, height } = map;
  const radius = effectiveRadius(zone);
  const point = createScreenPoint();
  map.project(zone.center.lat, zone.center.lon, point);
  const cx = point.x;
  const cy = point.y;
  projectNear(map, destinationPoint(zone.center, 90, radius), cx, point);
  let hx = point.x;
  let hy = point.y;
  let west = false;
  if (hx > width - 6) {
    projectNear(map, destinationPoint(zone.center, 270, radius), cx, point);
    if (point.x >= 6) {
      hx = point.x;
      hy = point.y;
      west = true;
    }
  }
  projectNear(map, destinationPoint(zone.center, 0, radius), cx, point);
  let labelX = point.x;
  let labelY = point.y;
  let below = false;
  if (labelY < 22) {
    projectNear(map, destinationPoint(zone.center, 180, radius), cx, point);
    labelX = point.x;
    labelY = point.y;
    below = true;
  }
  return {
    zone,
    centerLeft: cx / width,
    centerTop: cy / height,
    handleLeft: clamp(hx, 0, width) / width,
    handleTop: clamp(hy, 0, height) / height,
    handleWest: west,
    labelLeft: clamp(labelX, 48, width - 48) / width,
    labelTop: clamp(labelY, 0, height) / height,
    labelBelow: below,
  };
}

/** A device's rendered position as shares (0 to 1) of the map's width and height, kept on the map. */
interface PlacedDevice {
  device: TrackedDevice;
  left: number;
  top: number;
}

function placeDevice(device: TrackedDevice, map: MapProjection): PlacedDevice {
  const point = createScreenPoint();
  map.project(device.lat, device.lon, point);
  return {
    device,
    left: clamp(point.x, DEVICE_INSET, map.width - DEVICE_INSET) / map.width,
    top: clamp(point.y, DEVICE_INSET, map.height - DEVICE_INSET) / map.height,
  };
}

/** Devices off the map are pinned this far inside its edge. */
const DEVICE_INSET = 6;

/** Which side of its device a chip opens on, so it stays on the map. */
interface ChipSide {
  below: boolean;
  align: "start" | "center" | "end";
}

/** A chip side fixed when the chip opened, for the device it belongs to. */
interface ChipPlacement extends ChipSide {
  id: string;
}

/** Room a chip needs above its device, and half its width, in px. */
const CHIP_CLEARANCE = 48;
const CHIP_HALF_WIDTH = 84;

/** Opens below near the top edge, and toward the middle near the side edges. */
function chipSide(x: number, y: number, width: number): ChipSide {
  const align = x < CHIP_HALF_WIDTH ? "start" : x > width - CHIP_HALF_WIDTH ? "end" : "center";
  return { below: y < CHIP_CLEARANCE, align };
}

interface DeviceStatus {
  inside: boolean;
  /** Ids of the zones the device is in. */
  zones: string[];
}

function statusOf(device: LatLon, zones: readonly GeofenceZone[]): DeviceStatus {
  const inside = zones
    .filter((zone) => distanceKm(device, zone.center) <= effectiveRadius(zone))
    .map((zone) => zone.id);
  return { inside: inside.length > 0, zones: inside };
}

function computeStatuses(devices: readonly TrackedDevice[], zones: readonly GeofenceZone[]) {
  const statuses: Record<string, DeviceStatus> = {};
  for (const device of devices) statuses[device.id] = statusOf(device, zones);
  return statuses;
}

/* Demo fleet ---------------------------------------------------------------------------------------- */

/** One demo tracker: where it starts, the zone it lives in, and when it first wanders out. */
interface FleetTracker {
  device: TrackedDevice;
  anchor: LatLon;
  radiusKm: number;
  firstExcursion: number;
  seed: number;
}

interface Fleet {
  devices: readonly TrackedDevice[];
  trackers: readonly FleetTracker[];
}

/** Seconds until each tracker first heads out of its zone, so breaches come early and then spread out. */
const FIRST_EXCURSIONS = [0.6, 6.5, 12.5, 3.2, 9.5, 16];

/**
 * Six trackers spread over the starting zones (round robin), deterministic so the server and client agree. The first
 * starts near its fence, so the first breach plays within a few seconds.
 */
function createFleet(zones: readonly GeofenceZone[], view: GeoBounds): Fleet {
  const random = createRandom("geo-geofence");
  const homes =
    zones.length > 0
      ? zones.map((zone) => ({ anchor: zone.center, radiusKm: effectiveRadius(zone) }))
      : [
          {
            anchor: { lat: (view.south + view.north) / 2, lon: wrapLongitude((view.west + view.east) / 2) },
            radiusKm: 800,
          },
        ];
  const trackers: FleetTracker[] = [];
  for (let i = 0; i < 6; i++) {
    const home = homes[i % homes.length];
    const bearing = i === 0 ? 205 : random() * 360;
    const share = i === 0 ? 0.8 : 0.3 + random() * 0.4;
    const start = destinationPoint(home.anchor, bearing, home.radiusKm * share);
    trackers.push({
      device: { id: `tracker-${i + 1}`, label: `Tracker ${i + 1}`, lat: start.lat, lon: start.lon },
      anchor: home.anchor,
      radiusKm: home.radiusKm,
      firstExcursion: FIRST_EXCURSIONS[i],
      seed: Math.floor(random() * 1e9),
    });
  }
  return { devices: trackers.map((tracker) => tracker.device), trackers };
}

/* Engine --------------------------------------------------------------------------------------------- */

type DragKind = "center" | "radius";

/** The zones being dragged, as React state for the handles and the list. */
interface Draft {
  id: string;
  kind: DragKind;
  zones: readonly GeofenceZone[];
}

/** A pointer drag in progress. */
interface DragSession {
  id: string;
  kind: DragKind;
  pointerId: number;
  /** Pointer offset from the centre at the press, so the zone does not jump to the pointer. */
  offsetX: number;
  offsetY: number;
  /** Radius minus the pointer's distance at the press, for the same reason. */
  radiusOffset: number;
  /** The stored radius at the press: a centre drag toward a pole caps it, and moving away restores it. */
  startRadius: number;
  base: readonly GeofenceZone[];
  zones: readonly GeofenceZone[];
  moved: boolean;
}

/** The latest props the drawing code needs. */
interface Config {
  zones: readonly GeofenceZone[];
  /** The devices passed in, or null for the demo fleet. */
  devices: readonly TrackedDevice[] | null;
  fleet: Fleet;
  view: GeoBounds;
  /** The zone that is hovered, focused or dragged. */
  hot: string | null;
  drag: { id: string; kind: DragKind } | null;
}

interface InternalEvent {
  kind: "breach" | "enter";
  deviceId: string;
  zoneId: string;
  point: LatLon;
}

/** A pluck: pulses leave the fence point at `fraction` of the circle (from the north point, clockwise) at `start`. */
interface Pluck {
  fraction: number;
  start: number;
}

/** Reduced motion: the crossed section shows warning until `until`. */
interface FenceFlash {
  fraction: number;
  until: number;
}

/** A soft ring through the lattice where a device came back in. */
interface Ping {
  x: number;
  y: number;
  start: number;
}

/** A zone as the loop draws it: its circle, its fence dots on springs and the plucks running around it. */
interface ZoneRuntime {
  id: string;
  lat: number;
  lon: number;
  radius: number;
  /** Geometry key; a change rebuilds the circle. */
  key: string;
  /** The projected circle (RING_STEPS + 1 points, closed), for bearings to arc length. */
  main: ArcLengthTable | null;
  /** x offsets of the ∓360° copies drawn where the circle leaves the map's window. */
  copies: number[];
  /** Number of fence dots and the circle's length in px. */
  count: number;
  length: number;
  /** Fence dot targets, outward normals, sprung positions and velocities, stiffness, displacement. */
  tx: Float32Array;
  ty: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  stiffness: Float32Array;
  /** Centre and half extents in px, for the fill's reveal front. */
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  /** Arc length of the east point (the radius handle), for the stretch while resizing. */
  handleS: number;
  settled: boolean;
  /** Reveal: start time (−1 until the first frame) and whether it has finished. */
  growStart: number;
  grown: boolean;
  plucks: Pluck[];
  flashes: FenceFlash[];
  emphasis: Spring;
  /** Smoothed screen velocity of the centre while it is dragged, px/s. */
  velocityX: number;
  velocityY: number;
  lastX: number;
  lastY: number;
  resampled: ArcLengthTable | undefined;
}

type WalkMode = "roam" | "out" | "dwell" | "back";

/** A demo tracker's walk: it roams its zone and now and then heads out past the fence, waits, and comes back. */
interface Walk {
  random: () => number;
  anchor: LatLon;
  radiusKm: number;
  heading: number;
  /** Degrees of arc per second, easing toward `cruise`. */
  speed: number;
  cruise: number;
  mode: WalkMode;
  target: LatLon;
  timer: number;
  nextExcursion: number;
  phase: number;
}

interface DeviceRuntime {
  id: string;
  label: string;
  /** Shown position; `lon` is unwrapped while gliding. */
  lat: number;
  lon: number;
  targetLat: number;
  targetLon: number;
  glideLat: Spring;
  glideLon: Spring;
  walk: Walk | null;
  inside: boolean;
  zones: string[];
  /** False until the first containment check, which never fires an event. */
  known: boolean;
  /** Drawn position in px, kept on the map. */
  x: number;
  y: number;
}

/** The lattice as a full grid (land and sea positions), with per-frame compositing buffers. */
interface Cells {
  columns: number;
  rows: number;
  x0: number;
  y0: number;
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
  land: Uint8Array;
  jitter: Float32Array;
  density: Float32Array;
  tone: Float32Array;
  alpha: Float32Array;
  stamp: Uint32Array;
  touched: Int32Array;
  touchedCount: number;
  frame: number;
}

/** Everything the animation loop mutates. Lives in a ref, never in React state. */
interface Engine {
  projection: MapProjection | null;
  lattice: DotLattice | null;
  cells: Cells | null;
  width: number;
  height: number;
  ink: GeoInk | null;
  inkDirty: boolean;
  baseDirty: boolean;
  liveDirty: boolean;
  /** The projection changed: circles snap to their new place instead of springing. */
  jump: boolean;
  zones: Map<string, ZoneRuntime>;
  devices: Map<string, DeviceRuntime>;
  deviceMode: "demo" | "data" | null;
  deviceBases: Map<string, PlacedDevice>;
  /** Whether the previous containment check had zones; a change from none never fires events. */
  hadZones: boolean;
  pings: Ping[];
  sparks: Sparks;
  fxDirty: boolean;
  fxOffsetX: number;
  fxOffsetY: number;
  interiorBatch: DotBatch;
  fenceBatch: DotBatch;
  warnBatch: DotBatch;
  pingBatch: DotBatch;
  published: string;
  intersections: Float64Array;
}

function createEngine(): Engine {
  const grey: RGB = [128, 128, 128];
  return {
    projection: null,
    lattice: null,
    cells: null,
    width: 0,
    height: 0,
    ink: null,
    inkDirty: true,
    baseDirty: true,
    liveDirty: true,
    jump: true,
    zones: new Map(),
    devices: new Map(),
    deviceMode: null,
    deviceBases: new Map(),
    hadZones: false,
    pings: [],
    sparks: new Sparks(),
    fxDirty: false,
    fxOffsetX: 40,
    fxOffsetY: 32,
    interiorBatch: createDotBatch(4096, [grey, grey, grey], { tones: 24 }),
    fenceBatch: createDotBatch(512, [grey, grey], { tones: 12 }),
    warnBatch: createDotBatch(256, [grey, grey], { tones: 12 }),
    pingBatch: createDotBatch(512, [grey, grey, grey], { tones: 12 }),
    published: "",
    intersections: new Float64Array(64),
  };
}

/** Re-ramps the batches after a theme change. Status tones intensify toward the foreground, never toward violet. */
function applyInk(engine: Engine, ink: GeoInk) {
  engine.interiorBatch.setRamp([ink.land, ink.accent, ink.shine]);
  engine.fenceBatch.setRamp([ink.accent, ink.shine]);
  engine.warnBatch.setRamp([ink.accent, ink.warning]);
  engine.pingBatch.setRamp([ink.land, ink.success, mixRgb(ink.success, ink.foreground, 0.35)]);
}

function createCells(map: MapProjection, lattice: DotLattice, width: number, height: number): Cells {
  const frame = map.frame;
  const columns = Math.max(1, Math.ceil((frame.x1 - frame.x0) / PITCH) + 1);
  const rows = Math.max(1, Math.ceil((frame.y1 - frame.y0) / PITCH) + 1);
  const top = Math.max(0, frame.y0);
  const bottom = Math.min(height, frame.y1);
  const left = Math.max(0, frame.x0);
  const right = Math.min(width, frame.x1);
  const size = rows * columns;
  const land = new Uint8Array(size);
  for (let i = 0; i < lattice.count; i++) {
    const r = lattice.row[i];
    const c = lattice.column[i];
    if (r >= 0 && r < rows && c >= 0 && c < columns) land[r * columns + c] = 1;
  }
  const jitter = new Float32Array(size);
  const density = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const seed = i * 31 + 7;
    density[i] = hash(seed);
    jitter[i] = hash(seed + 1.13);
  }
  return {
    columns,
    rows,
    x0: frame.x0,
    y0: frame.y0,
    firstRow: Math.max(0, Math.ceil((top - frame.y0) / PITCH - 0.5)),
    lastRow: Math.min(rows - 1, Math.floor((bottom - frame.y0) / PITCH - 0.5)),
    firstColumn: Math.max(0, Math.ceil((left - frame.x0) / PITCH - 0.5)),
    lastColumn: Math.min(columns - 1, Math.floor((right - frame.x0) / PITCH - 0.5)),
    land,
    jitter,
    density,
    tone: new Float32Array(size),
    alpha: new Float32Array(size),
    stamp: new Uint32Array(size),
    touched: new Int32Array(size),
    touchedCount: 0,
    frame: 0,
  };
}

/** Builds the projection, lattice and cells for the map box and the configured view. */
function rebuild(engine: Engine, config: Config | null, surfaceWidth: number, surfaceHeight: number) {
  if (!config || !surfaceWidth || !surfaceHeight) return;
  const { view: current } = config;
  const map = createProjection("equirectangular", {
    width: surfaceWidth,
    height: surfaceHeight,
    lonRange: [current.west, current.east],
    latRange: [current.south, current.north],
  });
  engine.width = surfaceWidth;
  engine.height = surfaceHeight;
  if (engine.projection?.key === map.key) return;
  engine.projection = map;
  const lattice = mapLattice(map, { pitch: PITCH });
  if (engine.lattice !== lattice) {
    engine.lattice = lattice;
    engine.cells = createCells(map, lattice, surfaceWidth, surfaceHeight);
  }
  engine.baseDirty = true;
  engine.liveDirty = true;
  engine.jump = true;
  for (const runtime of engine.zones.values()) runtime.key = "";
}

/* Zones ---------------------------------------------------------------------------------------------- */

function createZoneRuntime(id: string): ZoneRuntime {
  const empty = new Float32Array(0);
  return {
    id,
    lat: 0,
    lon: 0,
    radius: 0,
    key: "",
    main: null,
    copies: [],
    count: 0,
    length: 0,
    tx: empty,
    ty: empty,
    nx: empty,
    ny: empty,
    x: empty,
    y: empty,
    vx: empty,
    vy: empty,
    stiffness: empty,
    cx: 0,
    cy: 0,
    ax: 1,
    ay: 1,
    handleS: 0,
    settled: true,
    growStart: -1,
    grown: false,
    plucks: [],
    flashes: [],
    emphasis: { position: 0, velocity: 0 },
    velocityX: 0,
    velocityY: 0,
    lastX: Number.NaN,
    lastY: Number.NaN,
    resampled: undefined,
  };
}

/** Matches the runtimes to the zones: new ones reveal themselves, changed ones rebuild, removed ones go. */
function syncZones(engine: Engine, zones: readonly GeofenceZone[], reduced: boolean) {
  const map = engine.projection;
  if (!map) return;
  const seen = new Set<string>();
  for (const zone of zones) {
    seen.add(zone.id);
    let runtime = engine.zones.get(zone.id);
    if (!runtime) {
      runtime = createZoneRuntime(zone.id);
      if (reduced) runtime.grown = true;
      engine.zones.set(zone.id, runtime);
    }
    const radius = effectiveRadius(zone);
    const key = `${zone.center.lat}|${zone.center.lon}|${radius}|${map.key}`;
    if (runtime.key === key) continue;
    const first = runtime.count === 0;
    runtime.lat = zone.center.lat;
    runtime.lon = zone.center.lon;
    runtime.radius = radius;
    runtime.key = key;
    buildRing(runtime, map, first || engine.jump || reduced);
    engine.liveDirty = true;
  }
  for (const id of [...engine.zones.keys()]) {
    if (seen.has(id)) continue;
    engine.zones.delete(id);
    engine.liveDirty = true;
  }
  engine.jump = false;
}

/**
 * Projects a zone's geodesic circle as one continuous ring, resamples it into fence dots every FENCE_SPACING px and
 * sets their targets and outward normals. Existing dots keep their spring state (remapped by position on the circle
 * when the dot count changes), so they spring to the new ring; `snap` puts them there at once.
 */
function buildRing(runtime: ZoneRuntime, map: MapProjection, snap: boolean) {
  const center = { lat: runtime.lat, lon: runtime.lon };
  const tables = projectPath(map, geodesicCircle(center, runtime.radius, RING_STEPS));
  const main = tables[0];
  runtime.main = main;
  runtime.copies = tables.slice(1).map((table) => table.xs[0] - main.xs[0]);
  runtime.length = Math.max(1, main.length);
  const count = clamp(Math.round(runtime.length / FENCE_SPACING), 12, 4000);
  const resampled = resampleArcLength(main, count + 1, runtime.resampled);
  runtime.resampled = resampled;

  if (count !== runtime.count) {
    const previous = runtime.count;
    const oldX = runtime.x;
    const oldY = runtime.y;
    const oldVX = runtime.vx;
    const oldVY = runtime.vy;
    runtime.tx = new Float32Array(count);
    runtime.ty = new Float32Array(count);
    runtime.nx = new Float32Array(count);
    runtime.ny = new Float32Array(count);
    runtime.x = new Float32Array(count);
    runtime.y = new Float32Array(count);
    runtime.vx = new Float32Array(count);
    runtime.vy = new Float32Array(count);
    runtime.stiffness = new Float32Array(count).fill(STIFFNESS);
    for (let k = 0; k < count; k++) {
      if (previous > 0) {
        const j = Math.round((k * previous) / count) % previous;
        runtime.x[k] = oldX[j];
        runtime.y[k] = oldY[j];
        runtime.vx[k] = oldVX[j];
        runtime.vy[k] = oldVY[j];
      } else {
        runtime.x[k] = resampled.xs[k];
        runtime.y[k] = resampled.ys[k];
      }
    }
    runtime.count = count;
  }

  let area = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    const x = resampled.xs[k];
    const y = resampled.ys[k];
    runtime.tx[k] = x;
    runtime.ty[k] = y;
    const next = (k + 1) % count;
    area += x * resampled.ys[next] - resampled.xs[next] * y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // the circle runs clockwise from north; on screen (y down) that gives a positive area and the normal (ty, −tx)
  const sign = area >= 0 ? 1 : -1;
  for (let k = 0; k < count; k++) {
    const before = (k - 1 + count) % count;
    const after = (k + 1) % count;
    const dx = runtime.tx[after] - runtime.tx[before];
    const dy = runtime.ty[after] - runtime.ty[before];
    const length = Math.hypot(dx, dy) || 1;
    runtime.nx[k] = (sign * dy) / length;
    runtime.ny[k] = (-sign * dx) / length;
  }
  const point = createScreenPoint();
  map.project(runtime.lat, runtime.lon, point);
  runtime.cx = point.x;
  runtime.cy = point.y;
  runtime.ax = Math.max(1, (maxX - minX) / 2);
  runtime.ay = Math.max(1, (maxY - minY) / 2);
  runtime.handleS = arcAtBearing(runtime, 90);
  if (snap) {
    runtime.x.set(runtime.tx);
    runtime.y.set(runtime.ty);
    runtime.vx.fill(0);
    runtime.vy.fill(0);
    runtime.settled = true;
  } else {
    runtime.settled = false;
  }
}

/** Arc length (px, from the north point, clockwise) of the circle point at a bearing from the centre. */
function arcAtBearing(runtime: ZoneRuntime, bearing: number) {
  const main = runtime.main;
  if (!main || main.count < 2) return 0;
  const f = ((((bearing % 360) + 360) % 360) / 360) * RING_STEPS;
  const i = Math.min(main.count - 2, Math.floor(f));
  const t = f - i;
  return main.distances[i] + (main.distances[i + 1] - main.distances[i]) * t;
}

/** Signed distance from b to a around a loop of `period`, in [−period/2, period/2). */
function loopDelta(a: number, b: number, period: number) {
  const d = (((a - b) % period) + period * 1.5) % period;
  return d - period / 2;
}

/** Springs, reveal, plucks and emphasis of every zone. Returns whether anything still moves. */
function stepZones(engine: Engine, config: Config, time: number, delta: number, reduced: boolean) {
  let busy = false;
  for (const runtime of engine.zones.values()) {
    const count = runtime.count;
    if (count === 0) continue;

    if (!runtime.grown) {
      if (runtime.growStart < 0) runtime.growStart = time;
      if (reduced || time - runtime.growStart >= FILL_DELAY + FILL_SECONDS) runtime.grown = true;
      busy = true;
    }

    const hot = config.hot === runtime.id ? 1 : 0;
    if (reduced) {
      runtime.emphasis.position = hot;
      runtime.emphasis.velocity = 0;
    } else if (Math.abs(runtime.emphasis.position - hot) > 0.002 || Math.abs(runtime.emphasis.velocity) > 0.01) {
      springStep(runtime.emphasis, hot, delta, 240, 1);
      busy = true;
    } else {
      runtime.emphasis.position = hot;
      runtime.emphasis.velocity = 0;
    }

    // stiffness: resizing pulls hardest near the handle, moving pulls the leading side, so the ring stretches
    const drag = config.drag && config.drag.id === runtime.id ? config.drag.kind : null;
    if (drag === "center" && delta > 0) {
      if (Number.isFinite(runtime.lastX)) {
        const smoothing = 1 - Math.exp(-delta / 0.06);
        runtime.velocityX += ((runtime.cx - runtime.lastX) / delta - runtime.velocityX) * smoothing;
        runtime.velocityY += ((runtime.cy - runtime.lastY) / delta - runtime.velocityY) * smoothing;
      }
      runtime.lastX = runtime.cx;
      runtime.lastY = runtime.cy;
    } else {
      runtime.velocityX = 0;
      runtime.velocityY = 0;
      runtime.lastX = Number.NaN;
      runtime.lastY = Number.NaN;
    }
    const speed = Math.hypot(runtime.velocityX, runtime.velocityY);
    const pull = clamp(speed / 360, 0, 1);
    for (let k = 0; k < count; k++) {
      let stiffness = STIFFNESS;
      if (drag === "radius") {
        const along = loopDelta((k / count) * runtime.length, runtime.handleS, runtime.length);
        const near = Math.exp(-((along / (0.3 * runtime.length)) ** 2));
        stiffness = STIFFNESS * (0.45 + 1.1 * near);
      } else if (drag === "center" && speed > 1) {
        const facing = (runtime.nx[k] * runtime.velocityX + runtime.ny[k] * runtime.velocityY) / speed;
        stiffness = STIFFNESS * (1 + 0.55 * facing * pull);
      }
      runtime.stiffness[k] = stiffness;
    }

    if (!runtime.settled) {
      if (reduced) {
        runtime.x.set(runtime.tx);
        runtime.y.set(runtime.ty);
        runtime.vx.fill(0);
        runtime.vy.fill(0);
        runtime.settled = true;
      } else {
        let moving = false;
        const dt = delta / 2;
        for (let k = 0; k < count; k++) {
          const stiffness = runtime.stiffness[k];
          const c = 2 * Math.sqrt(stiffness) * DAMPING;
          let x = runtime.x[k];
          let y = runtime.y[k];
          let vx = runtime.vx[k];
          let vy = runtime.vy[k];
          const tx = runtime.tx[k];
          const ty = runtime.ty[k];
          // two half steps, like springStep, for stability at 50 ms frames
          for (let half = 0; half < 2; half++) {
            vx += (stiffness * (tx - x) - c * vx) * dt;
            vy += (stiffness * (ty - y) - c * vy) * dt;
            x += vx * dt;
            y += vy * dt;
          }
          if (Math.abs(tx - x) > 0.03 || Math.abs(ty - y) > 0.03 || Math.abs(vx) > 0.4 || Math.abs(vy) > 0.4)
            moving = true;
          runtime.x[k] = x;
          runtime.y[k] = y;
          runtime.vx[k] = vx;
          runtime.vy[k] = vy;
        }
        if (!moving && !drag) {
          runtime.x.set(runtime.tx);
          runtime.y.set(runtime.ty);
          runtime.vx.fill(0);
          runtime.vy.fill(0);
          runtime.settled = true;
        }
        busy = true;
      }
    }

    if (runtime.plucks.length) {
      runtime.plucks = runtime.plucks.filter((pluck) => time - pluck.start < PLUCK_SECONDS);
      busy = true;
    }
    if (runtime.flashes.length) {
      const before = runtime.flashes.length;
      runtime.flashes = runtime.flashes.filter((flash) => time < flash.until);
      if (runtime.flashes.length !== before) engine.liveDirty = true;
      // the section turns back at its time; the loop has to be awake then
      if (runtime.flashes.length) busy = true;
    }
  }
  if (engine.pings.length) engine.pings = engine.pings.filter((ping) => time - ping.start < PING_SECONDS);
  return busy;
}

/* Devices -------------------------------------------------------------------------------------------- */

function createWalk(tracker: FleetTracker, start: LatLon): Walk {
  const random = createRandom(tracker.seed);
  return {
    random,
    anchor: tracker.anchor,
    radiusKm: tracker.radiusKm,
    heading: random() * 360,
    speed: 0.4,
    cruise: 0.4,
    mode: "roam",
    target: roamTarget(random, tracker.anchor, tracker.radiusKm, start),
    timer: 0,
    nextExcursion: tracker.firstExcursion,
    phase: random() * 10,
  };
}

/** A point to stroll to inside the zone, not too close to where the tracker is. */
function roamTarget(random: () => number, anchor: LatLon, radiusKm: number, from: LatLon) {
  let best = anchor;
  for (let i = 0; i < 4; i++) {
    best = destinationPoint(anchor, random() * 360, radiusKm * Math.sqrt(random()) * 0.62);
    if (distanceKm(best, from) > radiusKm * 0.35) break;
  }
  return best;
}

/** Advances a demo tracker along its walk. */
function stepWalk(device: DeviceRuntime, walk: Walk, time: number, delta: number) {
  const here = { lat: device.lat, lon: device.lon };
  const arrived = distanceKm(here, walk.target) < Math.max(25, walk.radiusKm * 0.05);
  const random = walk.random;
  switch (walk.mode) {
    case "roam":
      walk.nextExcursion -= delta;
      if (walk.nextExcursion <= 0) {
        // head out roughly the way it is already facing from the centre, past the fence
        const outward = initialBearing(walk.anchor, here) + (random() - 0.5) * 70;
        walk.mode = "out";
        walk.target = destinationPoint(walk.anchor, outward, walk.radiusKm * (1.22 + random() * 0.18));
        walk.cruise = 0.75 + random() * 0.3;
      } else if (arrived) {
        walk.target = roamTarget(random, walk.anchor, walk.radiusKm, here);
        walk.cruise = 0.3 + random() * 0.3;
      }
      break;
    case "out":
      if (arrived) {
        walk.mode = "dwell";
        walk.timer = 1.6 + random() * 2.2;
        walk.cruise = 0.1;
      }
      break;
    case "dwell":
      walk.timer -= delta;
      if (walk.timer <= 0) {
        walk.mode = "back";
        walk.target = destinationPoint(walk.anchor, random() * 360, walk.radiusKm * (0.2 + random() * 0.35));
        walk.cruise = 0.85 + random() * 0.35;
      }
      break;
    case "back":
      if (arrived) {
        walk.mode = "roam";
        walk.nextExcursion = 22 + random() * 20;
        walk.target = roamTarget(random, walk.anchor, walk.radiusKm, here);
        walk.cruise = 0.3 + random() * 0.3;
      }
      break;
  }
  walk.speed += (walk.cruise - walk.speed) * (1 - Math.exp(-delta / 0.8));
  // a slow wobble keeps the paths organic; it fades near the target so trackers do not circle it
  const distance = distanceKm(here, walk.target);
  const wobble = Math.sin(time * 0.7 + walk.phase) * 26 * clamp(distance / (walk.radiusKm * 0.4), 0, 1);
  const desired = initialBearing(here, walk.target) + wobble;
  const turn = angleDelta(walk.heading, desired);
  walk.heading += clamp(turn, -110 * delta, 110 * delta);
  const next = destinationPoint(here, walk.heading, walk.speed * delta * KM_PER_DEGREE);
  device.lat = next.lat;
  device.lon = next.lon;
}

/** Moves every device: the demo walk, or a glide to the latest data. Returns whether the loop must keep running. */
function stepDevices(engine: Engine, config: Config, time: number, delta: number, reduced: boolean) {
  const map = engine.projection;
  if (!map) return false;
  const mode = config.devices ? "data" : "demo";
  if (engine.deviceMode !== mode) {
    engine.devices.clear();
    engine.deviceMode = mode;
  }
  let busy = false;
  if (mode === "demo") {
    if (engine.devices.size === 0) {
      for (const tracker of config.fleet.trackers) {
        const { device } = tracker;
        engine.devices.set(device.id, createDeviceRuntime(device, createWalk(tracker, device)));
      }
    }
    for (const device of engine.devices.values()) if (device.walk) stepWalk(device, device.walk, time, delta);
    busy = engine.devices.size > 0;
  } else {
    const list = config.devices ?? [];
    const seen = new Set<string>();
    for (const item of list) {
      seen.add(item.id);
      let device = engine.devices.get(item.id);
      if (!device) {
        device = createDeviceRuntime(item, null);
        engine.devices.set(item.id, device);
      }
      device.label = item.label ?? item.id;
      device.targetLat = item.lat;
      // the short way round: the glide never crosses the whole map
      device.targetLon = device.lon + angleDelta(device.lon, item.lon);
      if (reduced) {
        device.lat = device.targetLat;
        device.lon = device.targetLon;
        device.glideLat.velocity = 0;
        device.glideLon.velocity = 0;
        continue;
      }
      device.glideLat.position = device.lat;
      device.glideLon.position = device.lon;
      const latLeft = Math.abs(device.targetLat - device.lat) > 1e-5 || Math.abs(device.glideLat.velocity) > 1e-4;
      const lonLeft = Math.abs(device.targetLon - device.lon) > 1e-5 || Math.abs(device.glideLon.velocity) > 1e-4;
      if (latLeft || lonLeft) {
        springStep(device.glideLat, device.targetLat, delta, GLIDE_STIFFNESS, 1);
        springStep(device.glideLon, device.targetLon, delta, GLIDE_STIFFNESS, 1);
        device.lat = device.glideLat.position;
        device.lon = device.glideLon.position;
        busy = true;
      } else {
        device.lat = device.targetLat;
        device.lon = device.targetLon;
        device.glideLat.velocity = 0;
        device.glideLon.velocity = 0;
      }
    }
    for (const id of [...engine.devices.keys()]) if (!seen.has(id)) engine.devices.delete(id);
  }
  const point = createScreenPoint();
  for (const device of engine.devices.values()) {
    map.project(device.lat, wrapLongitude(device.lon), point);
    device.x = clamp(point.x, DEVICE_INSET, engine.width - DEVICE_INSET);
    device.y = clamp(point.y, DEVICE_INSET, engine.height - DEVICE_INSET);
  }
  return busy;
}

function createDeviceRuntime(device: TrackedDevice, walk: Walk | null): DeviceRuntime {
  return {
    id: device.id,
    label: device.label ?? device.id,
    lat: device.lat,
    lon: device.lon,
    targetLat: device.lat,
    targetLon: device.lon,
    glideLat: { position: device.lat, velocity: 0 },
    glideLon: { position: device.lon, velocity: 0 },
    walk,
    inside: false,
    zones: [],
    known: false,
    x: 0,
    y: 0,
  };
}

/** Moves each device button from its rendered position to where the loop draws the device. */
function writeDevices(engine: Engine, elements: Map<string, HTMLButtonElement>) {
  if (!engine.width || !engine.height) return;
  for (const [id, element] of elements) {
    const device = engine.devices.get(id);
    const placed = engine.deviceBases.get(id);
    if (!device || !placed) continue;
    const dx = device.x - placed.left * engine.width;
    const dy = device.y - placed.top * engine.height;
    element.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
  }
}

/**
 * Checks every device against every zone. A device is outside only when it has left every zone; the zone it left last
 * rings. The first check of a device, and a change to or from no zones at all, never fire events.
 */
function checkContainment(engine: Engine, zones: readonly GeofenceZone[]): InternalEvent[] {
  const events: InternalEvent[] = [];
  const hasZones = zones.length > 0;
  for (const device of engine.devices.values()) {
    const here = { lat: device.lat, lon: wrapLongitude(device.lon) };
    const inside: string[] = [];
    for (const zone of zones) if (distanceKm(here, zone.center) <= effectiveRadius(zone)) inside.push(zone.id);
    const isInside = inside.length > 0;
    if (device.known && hasZones && engine.hadZones) {
      if (device.inside && !isInside) {
        // the zone with the smallest overshoot is the one the device just crossed
        let best: GeofenceZone | null = null;
        let bestOvershoot = Infinity;
        for (const id of device.zones) {
          const zone = zones.find((entry) => entry.id === id);
          if (!zone) continue;
          const overshoot = distanceKm(here, zone.center) - effectiveRadius(zone);
          if (overshoot < bestOvershoot) {
            bestOvershoot = overshoot;
            best = zone;
          }
        }
        if (best) events.push({ kind: "breach", deviceId: device.id, zoneId: best.id, point: fencePoint(best, here) });
      } else if (!device.inside && isInside) {
        let best: GeofenceZone | null = null;
        let bestDepth = -Infinity;
        for (const zone of zones) {
          if (!inside.includes(zone.id)) continue;
          const depth = effectiveRadius(zone) - distanceKm(here, zone.center);
          // the fence it just crossed is the nearest one
          if (best === null || depth < bestDepth) {
            bestDepth = depth;
            best = zone;
          }
        }
        if (best) events.push({ kind: "enter", deviceId: device.id, zoneId: best.id, point: fencePoint(best, here) });
      }
    }
    device.known = true;
    device.inside = isInside;
    device.zones = inside;
  }
  engine.hadZones = hasZones;
  return events;
}

/** The point on a zone's fence in the direction of `point`. */
function fencePoint(zone: GeofenceZone, point: LatLon): LatLon {
  return destinationPoint(zone.center, initialBearing(zone.center, point), effectiveRadius(zone));
}

/** Starts the visuals of an event: the pluck (or the reduced-motion section), sparks, or the re-entry ring. */
function fireEvent(engine: Engine, event: InternalEvent, time: number, reduced: boolean) {
  const runtime = engine.zones.get(event.zoneId);
  const device = engine.devices.get(event.deviceId);
  if (!runtime || !device || !runtime.main) return;
  engine.liveDirty = true;
  if (event.kind === "enter") {
    if (!reduced) engine.pings.push({ x: device.x, y: device.y, start: time });
    return;
  }
  const bearing = initialBearing({ lat: runtime.lat, lon: runtime.lon }, event.point);
  const s = arcAtBearing(runtime, bearing);
  const fraction = s / runtime.length;
  if (reduced) {
    runtime.flashes.push({ fraction, until: time + FLASH_SECONDS });
    return;
  }
  runtime.plucks.push({ fraction, start: time });
  const ink = engine.ink;
  if (!ink) return;
  const point = { x: 0, y: 0, angle: 0 };
  pointAtDistance(runtime.main, s, point);
  // sparks leave along the outward normal, the way the device went
  const k = Math.round(fraction * runtime.count) % runtime.count;
  const angle = Math.atan2(runtime.ny[k], runtime.nx[k]);
  engine.sparks.add(
    point.x + engine.fxOffsetX,
    point.y + engine.fxOffsetY,
    14,
    [ink.warning, ink.warning, ink.accent],
    {
      ...SPARK_OPTIONS,
      angle,
    },
  );
}

/* Drawing -------------------------------------------------------------------------------------------- */

/** The static land layer: one colour, every dot snapped to device pixels. */
function bakeLand(surface: CanvasSurface, lattice: DotLattice, color: RGB) {
  const { context, width, height, dpr } = surface;
  context.clearRect(0, 0, width, height);
  context.fillStyle = rgba(color);
  const half = LAND_DOT / 2;
  for (let i = 0; i < lattice.count; i++) {
    const x = Math.round((lattice.x[i] - half) * dpr) / dpr;
    const y = Math.round((lattice.y[i] - half) * dpr) / dpr;
    context.fillRect(x, y, LAND_DOT, LAND_DOT);
  }
}

/** Composites one dot offer into the per-frame buffers: the brighter offer wins. */
function offer(cells: Cells, index: number, tone: number, alpha: number) {
  if (cells.stamp[index] !== cells.frame) {
    cells.stamp[index] = cells.frame;
    cells.tone[index] = tone;
    cells.alpha[index] = alpha;
    cells.touched[cells.touchedCount++] = index;
    return;
  }
  if (alpha > cells.alpha[index]) cells.alpha[index] = alpha;
  if (tone > cells.tone[index]) cells.tone[index] = tone;
}

/**
 * Fills a zone's interior from its sprung fence (so the dots inside always match the ring the eye sees): a scanline
 * over the lattice rows, even-odd between the crossings. Land turns the accent's tint, the sea carries a sparse print,
 * and both glow toward the fence. While the zone is new, the fill grows out of the centre behind an uneven front.
 */
function fillZone(engine: Engine, runtime: ZoneRuntime, offsetX: number, time: number) {
  const cells = engine.cells;
  if (!cells) return;
  const count = runtime.count;
  const xs = runtime.x;
  const ys = runtime.y;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    minY = Math.min(minY, ys[k]);
    maxY = Math.max(maxY, ys[k]);
  }
  const firstRow = Math.max(cells.firstRow, Math.ceil((minY - cells.y0) / PITCH - 0.5));
  const lastRow = Math.min(cells.lastRow, Math.floor((maxY - cells.y0) / PITCH - 0.5));
  const emphasis = runtime.emphasis.position;
  const growing = !runtime.grown;
  const fill = growing ? easeOutCubic((time - runtime.growStart - FILL_DELAY) / FILL_SECONDS) * (1.18 + GROW_BAND) : 2;
  const hits = engine.intersections;

  for (let r = firstRow; r <= lastRow; r++) {
    const y = cells.y0 + (r + 0.5) * PITCH;
    let hitCount = 0;
    for (let k = 0; k < count; k++) {
      const next = k + 1 === count ? 0 : k + 1;
      const y1 = ys[k];
      const y2 = ys[next];
      if (y1 <= y === y2 <= y) continue;
      const x = xs[k] + ((y - y1) * (xs[next] - xs[k])) / (y2 - y1) + offsetX;
      // insertion sort: a row crosses a ring only a handful of times
      let h = hitCount;
      while (h > 0 && hits[h - 1] > x) {
        hits[h] = hits[h - 1];
        h--;
      }
      hits[h] = x;
      if (hitCount < hits.length - 1) hitCount++;
    }
    for (let h = 0; h + 1 < hitCount; h += 2) {
      const left = hits[h];
      const right = hits[h + 1];
      const firstColumn = Math.max(cells.firstColumn, Math.ceil((left - cells.x0) / PITCH - 0.5));
      const lastColumn = Math.min(cells.lastColumn, Math.floor((right - cells.x0) / PITCH - 0.5));
      for (let c = firstColumn; c <= lastColumn; c++) {
        const x = cells.x0 + (c + 0.5) * PITCH;
        const index = r * cells.columns + c;
        const land = cells.land[index] === 1;
        const edge = Math.min(x - left, right - x);
        if (!land && (edge < 1.6 || cells.density[index] > SEA_DENSITY)) continue;
        const rim = 1 - smoothstep(0, RIM_PX, edge);
        let tone = land ? 0.24 + 0.14 * rim + 0.1 * emphasis : 0.5;
        let alpha = land ? 1 : (0.17 + 0.22 * rim) * (1 + 0.5 * emphasis);
        if (growing) {
          const n = Math.hypot((x - runtime.cx - offsetX) / runtime.ax, (y - runtime.cy) / runtime.ay);
          const lead = fill - (n * 0.82 + cells.jitter[index] * 0.18);
          if (lead <= 0) continue;
          if (lead < GROW_BAND) {
            const flash = 1 - lead / GROW_BAND;
            tone += (1 - tone) * flash * 0.85;
            alpha = Math.max(alpha, land ? 1 : 0.55 * flash);
          }
          alpha *= Math.min(1, lead / 0.03);
        }
        offer(cells, index, tone, alpha);
      }
    }
  }
}

/** The fence: dots on their springs, pushed out along the normal by the plucks, in the warning colour where they move. */
function drawFence(engine: Engine, runtime: ZoneRuntime, time: number, dpr: number) {
  const count = runtime.count;
  const length = runtime.length;
  const emphasis = runtime.emphasis.position;
  const growing = !runtime.grown;
  const fenceGrowth = growing ? easeOutCubic((time - runtime.growStart) / FENCE_GROW_SECONDS) * 1.08 : 2;
  const twoSigmaSquared = 2 * PLUCK_SIGMA * PLUCK_SIGMA;
  const offsets = runtime.copies.length ? [0, ...runtime.copies] : ZERO_OFFSET;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * length;
    let tone = 0;
    let alpha = 0.9 + 0.1 * emphasis;
    if (growing) {
      // the fence draws itself from the north point both ways round, the two ends meeting in the south
      const along = Math.abs(loopDelta(s, 0, length)) / (length / 2);
      const lead = fenceGrowth - (along * 0.94 + hash(k * 7.31 + 0.5) * 0.06);
      if (lead <= 0) continue;
      if (lead < GROW_BAND) tone = 1 - lead / GROW_BAND;
      alpha *= Math.min(1, lead / 0.02);
    }
    let displacement = 0;
    for (const pluck of runtime.plucks) {
      const t = time - pluck.start;
      if (t < 0) continue;
      const amplitude = PLUCK_AMPLITUDE * Math.exp(-t / PLUCK_DECAY) * (1 - smoothstep(0.8, PLUCK_SECONDS, t));
      const origin = pluck.fraction * length;
      const travel = PLUCK_SPEED * t;
      const ahead = loopDelta(s, origin + travel, length);
      const behind = loopDelta(s, origin - travel, length);
      displacement +=
        amplitude * (Math.exp(-(ahead * ahead) / twoSigmaSquared) + Math.exp(-(behind * behind) / twoSigmaSquared));
    }
    let warning = Math.min(1, Math.abs(displacement) / PLUCK_AMPLITUDE);
    for (const flash of runtime.flashes) {
      if (Math.abs(loopDelta(s, flash.fraction * length, length)) < FLASH_REACH) warning = 1;
    }
    const x = runtime.x[k] + displacement * runtime.nx[k];
    const y = runtime.y[k] + displacement * runtime.ny[k];
    const size = warning > 0.45 || tone > 0.5 ? FENCE_DOT_HOT : FENCE_DOT;
    for (const offset of offsets) {
      const px = snapCenter(x + offset, size, dpr);
      const py = snapCenter(y, size, dpr);
      if (warning > 0.02) engine.warnBatch.add(px, py, size, warning, Math.min(1, alpha + 0.6 * warning));
      else engine.fenceBatch.add(px, py, size, tone, alpha);
    }
  }
}

const ZERO_OFFSET = [0];

/** The soft success ring through the dots around a device that came back in. */
function drawPing(engine: Engine, ping: Ping, time: number, dpr: number) {
  const cells = engine.cells;
  if (!cells) return;
  const t = clamp((time - ping.start) / PING_SECONDS, 0, 1);
  const radius = 2 + PING_REACH * easeOutCubic(t);
  const fade = Math.pow(1 - t, 1.4);
  const reach = radius + 10;
  const firstRow = Math.max(cells.firstRow, Math.ceil((ping.y - reach - cells.y0) / PITCH - 0.5));
  const lastRow = Math.min(cells.lastRow, Math.floor((ping.y + reach - cells.y0) / PITCH - 0.5));
  const firstColumn = Math.max(cells.firstColumn, Math.ceil((ping.x - reach - cells.x0) / PITCH - 0.5));
  const lastColumn = Math.min(cells.lastColumn, Math.floor((ping.x + reach - cells.x0) / PITCH - 0.5));
  for (let r = firstRow; r <= lastRow; r++) {
    const y = cells.y0 + (r + 0.5) * PITCH;
    for (let c = firstColumn; c <= lastColumn; c++) {
      const x = cells.x0 + (c + 0.5) * PITCH;
      const index = r * cells.columns + c;
      const strength = ringFront(Math.hypot(x - ping.x, y - ping.y), radius, 4, cells.jitter[index], 3) * fade;
      if (strength < 0.05) continue;
      const land = cells.land[index] === 1;
      const size = strength > 0.6 ? FENCE_DOT : LAND_DOT;
      engine.pingBatch.add(
        snapCenter(x, size, dpr),
        snapCenter(y, size, dpr),
        size,
        0.5 + 0.5 * strength,
        land ? strength : 0.6 * strength,
      );
    }
  }
}

/** Draws the live layer: zone interiors (composited), re-entry rings, then every fence on top. */
function drawLive(engine: Engine, surface: CanvasSurface, time: number, reduced: boolean) {
  const { context, width, height, dpr } = surface;
  const cells = engine.cells;
  context.clearRect(0, 0, width, height);
  if (!cells) return;
  cells.frame = (cells.frame + 1) >>> 0 || 1;
  cells.touchedCount = 0;
  for (const runtime of engine.zones.values()) {
    if (runtime.count === 0) continue;
    fillZone(engine, runtime, 0, time);
    for (const offset of runtime.copies) fillZone(engine, runtime, offset, time);
  }
  for (let k = 0; k < cells.touchedCount; k++) {
    const index = cells.touched[k];
    const r = Math.floor(index / cells.columns);
    const c = index - r * cells.columns;
    const x = cells.x0 + (c + 0.5) * PITCH;
    const y = cells.y0 + (r + 0.5) * PITCH;
    engine.interiorBatch.add(
      snapCenter(x, LAND_DOT, dpr),
      snapCenter(y, LAND_DOT, dpr),
      LAND_DOT,
      cells.tone[index],
      Math.min(1, cells.alpha[index]),
    );
  }
  engine.interiorBatch.flush(context);
  if (!reduced) for (const ping of engine.pings) drawPing(engine, ping, time, dpr);
  engine.pingBatch.flush(context);
  for (const runtime of engine.zones.values()) if (runtime.count > 0) drawFence(engine, runtime, time, dpr);
  engine.fenceBatch.flush(context);
  engine.warnBatch.flush(context);
}

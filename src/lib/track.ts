/** The events the site sends from the browser. */
export const TRACK_TYPES = [
  "page_view",
  "copy_code",
  "copy_install",
  "copy_page",
  "open_in",
  "feedback",
  "preview_action",
  "search",
] as const;

/** One of {@link TRACK_TYPES}. */
export type TrackType = (typeof TRACK_TYPES)[number];

type Meta = Record<string, string | number | boolean | null>;

/**
 * Cookieless, anonymous event beacon. No identifiers are created or stored on the device, and nothing is sent
 * when Do Not Track or Global Privacy Control is on. Failures are ignored: statistics never break the page.
 */
export function track(type: TrackType, item?: string | null, meta?: Meta) {
  if (typeof navigator === "undefined") return;
  if (navigator.doNotTrack === "1" || ("globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true)) return;
  try {
    const body = JSON.stringify({ type, item: item ?? null, path: location.pathname, ref: referrerHost(), meta: meta ?? null });
    const sent = navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
    }
  } catch {
    // statistics are best effort
  }
}

/** The referring site's host, or null for internal navigation and direct visits. */
function referrerHost() {
  if (!document.referrer) return null;
  const host = new URL(document.referrer).host;
  return host === location.host ? null : host;
}

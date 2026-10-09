import "server-only";

import { BlockList, isIP } from "node:net";

const family = (address: string) => (isIP(address) === 6 ? "ipv6" : "ipv4");

/**
 * Proxies whose X-Forwarded-For entries are skipped when looking for the client address: loopback and the
 * private ranges (a reverse proxy or container network on the same host), plus anything listed in
 * TRUSTED_PROXIES (comma-separated addresses or CIDR ranges).
 */
function trustedProxies() {
  const list = new BlockList();
  const add = (entry: string) => {
    const [address = "", prefix] = entry.trim().split("/");
    if (!isIP(address)) return;
    if (prefix === undefined) list.addAddress(address, family(address));
    else list.addSubnet(address, Number(prefix), family(address));
  };
  for (const range of ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7"])
    add(range);
  for (const entry of (process.env.TRUSTED_PROXIES ?? "").split(",")) if (entry.trim()) add(entry);
  return list;
}

const trusted = trustedProxies();

/** One X-Forwarded-For entry without brackets, port or IPv4-mapped prefix. */
function normalise(entry: string) {
  let address = entry.trim();
  if (address.startsWith("[")) address = address.slice(1, address.indexOf("]"));
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : null;
  if (mapped && isIP(mapped) === 4) address = mapped;
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(":"));
  return address;
}

/**
 * The client address behind the trusted proxies: the right-most X-Forwarded-For entry that is not a trusted
 * proxy, or null when there is none or it is malformed. Entries further left are set by the client and are
 * never trusted. Used for rate limits only, never stored.
 */
export function clientIp(headers: Headers): string | null {
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map(normalise).filter(Boolean).reverse();
  for (const address of chain) {
    if (!isIP(address)) return null;
    if (!trusted.check(address, family(address))) return address;
  }
  return null;
}

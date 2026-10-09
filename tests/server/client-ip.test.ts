import { beforeAll, describe, expect, it, vi } from "vitest";

type ClientIp = typeof import("@/lib/server/client-ip").clientIp;

/** A fresh copy of the module, since it reads TRUSTED_PROXIES once, when it loads. */
async function loadClientIp(trustedProxies: string): Promise<ClientIp> {
  vi.stubEnv("TRUSTED_PROXIES", trustedProxies);
  vi.resetModules();
  const { clientIp } = await import("@/lib/server/client-ip");
  return clientIp;
}

const forwardedFor = (value: string) => new Headers({ "x-forwarded-for": value });

describe("clientIp", () => {
  let clientIp: ClientIp;

  beforeAll(async () => {
    clientIp = await loadClientIp("");
  });

  it("returns null without an X-Forwarded-For header", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(forwardedFor(""))).toBeNull();
    expect(clientIp(forwardedFor(" , ,"))).toBeNull();
  });

  it("returns a single public address", () => {
    expect(clientIp(forwardedFor("203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIp(forwardedFor("  203.0.113.7 , "))).toBe("203.0.113.7");
  });

  it("takes the right-most entry that is not a trusted proxy", () => {
    expect(clientIp(forwardedFor("198.51.100.1, 203.0.113.7"))).toBe("203.0.113.7");
  });

  it("skips loopback and private proxies", () => {
    const chain = "203.0.113.7, 10.1.2.3, 172.16.5.4, 172.31.255.254, 192.168.1.1, 127.0.0.1, fd12::1, ::1";
    expect(clientIp(forwardedFor(chain))).toBe("203.0.113.7");
  });

  it("ignores entries the client put in front, even ones that look trusted", () => {
    expect(clientIp(forwardedFor("127.0.0.1, 203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIp(forwardedFor("10.0.0.1, 192.0.2.99, 203.0.113.7, 10.0.0.2"))).toBe("203.0.113.7");
  });

  it("treats 172.32.0.0 as public: only 172.16.0.0/12 is private", () => {
    expect(clientIp(forwardedFor("203.0.113.7, 172.32.0.1"))).toBe("172.32.0.1");
  });

  it("returns null when every entry is a trusted proxy", () => {
    expect(clientIp(forwardedFor("10.0.0.1, 127.0.0.1, ::1"))).toBeNull();
  });

  it("reads IPv6 addresses, with or without brackets and port", () => {
    expect(clientIp(forwardedFor("2001:db8::1"))).toBe("2001:db8::1");
    expect(clientIp(forwardedFor("[2001:db8::1]:443"))).toBe("2001:db8::1");
    expect(clientIp(forwardedFor("2001:db8::1, [::1]:3000"))).toBe("2001:db8::1");
  });

  it("drops the port of an IPv4 entry", () => {
    expect(clientIp(forwardedFor("203.0.113.7:51234"))).toBe("203.0.113.7");
    expect(clientIp(forwardedFor("203.0.113.7, 127.0.0.1:8080"))).toBe("203.0.113.7");
  });

  it("unwraps IPv4-mapped IPv6 addresses before the trust check", () => {
    expect(clientIp(forwardedFor("::ffff:203.0.113.7"))).toBe("203.0.113.7");
    expect(clientIp(forwardedFor("203.0.113.9, ::FFFF:10.0.0.1"))).toBe("203.0.113.9");
  });

  it("returns null when the right-most untrusted entry is malformed, without falling back further left", () => {
    expect(clientIp(forwardedFor("unknown"))).toBeNull();
    expect(clientIp(forwardedFor("203.0.113.7, not-an-address"))).toBeNull();
    expect(clientIp(forwardedFor("203.0.113.7, 203.0.113.8:port"))).toBeNull();
    expect(clientIp(forwardedFor("203.0.113.7, 999.1.1.1, 10.0.0.1"))).toBeNull();
  });
});

describe("clientIp with TRUSTED_PROXIES", () => {
  const chain = "192.0.2.1, 198.51.100.10, 203.0.113.50";

  it("treats a public proxy as the client when it is not listed", async () => {
    const clientIp = await loadClientIp("");
    expect(clientIp(forwardedFor(chain))).toBe("203.0.113.50");
  });

  it("skips listed addresses and CIDR ranges, IPv4 and IPv6", async () => {
    const clientIp = await loadClientIp("203.0.113.0/24, 198.51.100.10, 2001:db8:ffff::/48");
    expect(clientIp(forwardedFor(chain))).toBe("192.0.2.1");
    expect(clientIp(forwardedFor("2001:db8::1, 2001:db8:ffff::5"))).toBe("2001:db8::1");
  });

  it("ignores entries that are not addresses", async () => {
    const clientIp = await loadClientIp(" , proxy.internal, 203.0.113.0/24");
    expect(clientIp(forwardedFor("192.0.2.1, 203.0.113.50"))).toBe("192.0.2.1");
  });
});

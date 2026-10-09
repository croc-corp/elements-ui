import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH, POST } from "@/app/api/feedback/route";
import { readJsonObject } from "@/lib/server/request";

const ENDPOINT = "http://localhost/api/feedback";

function request(method: "POST" | "PATCH", body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const vote = (body: unknown, headers?: Record<string, string>) => POST(request("POST", body, headers));
const note = (body: unknown, headers?: Record<string, string>) => PATCH(request("PATCH", body, headers));

const token = () => randomBytes(16).toString("base64url");

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

describe("POST /api/feedback without a statistics database", () => {
  it("accepts a vote and returns a null token", async () => {
    const response = await vote({ path: "/docs/installation", helpful: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: null });
  });

  it("accepts a vote with a note", async () => {
    const response = await vote({ path: "/components/pixel-ui/button", helpful: false, note: "Missing an example." });
    expect(response.status).toBe(200);
  });

  it.each([
    ["a full URL", "https://example.com/docs"],
    ["protocol-relative", "//evil.example/docs"],
    ["relative", "docs/installation"],
    ["empty", ""],
    ["a number", 42],
  ])("rejects a path that is %s", async (_, path) => {
    expect((await vote({ path, helpful: true })).status).toBe(400);
  });

  it("rejects a vote without a path", async () => {
    expect((await vote({ helpful: true })).status).toBe(400);
  });

  it.each([["yes"], [1], [null], [undefined]])("rejects %j as helpful", async (helpful) => {
    expect((await vote({ path: "/docs", helpful })).status).toBe(400);
  });

  it.each([
    ["invalid JSON", "{path: '/docs'"],
    ["an array", JSON.stringify([{ path: "/docs", helpful: true }])],
    ["null", "null"],
    ["a string", JSON.stringify("/docs")],
    ["empty", ""],
  ])("rejects a body that is %s", async (_, body) => {
    expect((await vote(body)).status).toBe(400);
  });

  it("rejects a body over 4000 characters, even with a valid vote in it", async () => {
    const path = `/docs/${"a".repeat(4000)}`;
    expect((await vote({ path, helpful: true })).status).toBe(400);
  });
});

describe("PATCH /api/feedback without a statistics database", () => {
  it("accepts a note for a well-formed token with 204 and no body", async () => {
    const response = await note({ token: token(), note: "The keyboard section helped." });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["missing", undefined],
    ["too short", "abc"],
    ["too long", `${token()}A`],
    ["outside base64url", `${token().slice(0, 21)}!`],
    ["not a string", 1234567890],
  ])("rejects a token that is %s", async (_, value) => {
    expect((await note({ token: value, note: "Helpful." })).status).toBe(400);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["only whitespace", "  \n\t "],
    ["not a string", 5],
  ])("rejects a note that is %s", async (_, value) => {
    expect((await note({ token: token(), note: value })).status).toBe(400);
  });
});

describe("rate limit of /api/feedback", () => {
  it("allows 30 requests per client address, then answers 429 to POST and PATCH", async () => {
    const client = { "x-forwarded-for": "203.0.113.30" };
    for (let i = 0; i < 30; i++) expect((await vote({ path: "/docs", helpful: true }, client)).status).toBe(200);
    expect((await vote({ path: "/docs", helpful: true }, client)).status).toBe(429);
    expect((await note({ token: token(), note: "Late." }, client)).status).toBe(429);

    const other = { "x-forwarded-for": "203.0.113.31" };
    expect((await vote({ path: "/docs", helpful: true }, other)).status).toBe(200);
  });
});

describe("readJsonObject", () => {
  const body = (length: number) => {
    const text = JSON.stringify({ a: "x".repeat(length - 8) });
    expect(text).toHaveLength(length);
    return text;
  };

  it("returns the object in the body", async () => {
    const req = new Request(ENDPOINT, { method: "POST", body: JSON.stringify({ path: "/docs", helpful: true }) });
    expect(await readJsonObject(req, 100)).toEqual({ path: "/docs", helpful: true });
  });

  it("accepts a body of exactly maxLength characters", async () => {
    const req = new Request(ENDPOINT, { method: "POST", body: body(100) });
    expect(await readJsonObject(req, 100)).not.toBeNull();
  });

  it("rejects a longer body when Content-Length is missing", async () => {
    const req = new Request(ENDPOINT, { method: "POST", body: body(101) });
    expect(req.headers.has("content-length")).toBe(false);
    expect(await readJsonObject(req, 100)).toBeNull();
  });

  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const req = new Request(ENDPOINT, { method: "POST", body: "{}", headers: { "content-length": "101" } });
    expect(await readJsonObject(req, 100)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it("returns null for JSON that is not a plain object", async () => {
    for (const text of ["[]", "null", "3", '"text"', "true"]) {
      expect(await readJsonObject(new Request(ENDPOINT, { method: "POST", body: text }), 100)).toBeNull();
    }
  });

  it("returns null for a body that is not JSON", async () => {
    expect(await readJsonObject(new Request(ENDPOINT, { method: "POST", body: "{" }), 100)).toBeNull();
  });

  it("returns null for a body that was already read", async () => {
    const req = new Request(ENDPOINT, { method: "POST", body: "{}" });
    await req.text();
    expect(await readJsonObject(req, 100)).toBeNull();
  });
});

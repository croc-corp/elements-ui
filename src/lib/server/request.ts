import "server-only";

/**
 * The JSON object in a request body, or null when the body is too large, is not JSON or is not a plain object.
 * `Content-Length` is checked before reading and the text length after, since the header may be missing.
 */
export async function readJsonObject(req: Request, maxLength: number): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxLength) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > maxLength) return null;
  try {
    const body: unknown = JSON.parse(text);
    return isPlainObject(body) ? body : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

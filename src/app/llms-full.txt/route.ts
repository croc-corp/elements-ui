import { fullMarkdown } from "@/lib/llm";

export const dynamic = "force-static";

export async function GET() {
  return new Response(await fullMarkdown(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

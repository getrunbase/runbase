import { source } from "@/lib/source";
import { siteUrl } from "@/lib/site";

// llms.txt (llmstxt.org): index of the docs pages for AI agents and answer engines.
export function GET() {
  const lines = source
    .getPages()
    .map((p) => `- [${p.data.title}](${siteUrl()}${p.url})${p.data.description ? `: ${p.data.description}` : ""}`);
  const body = `# Runbase docs\n\n> Documentation for Runbase: data, automation and interfaces, built by AI agents through MCP.\n\n## Pages\n\n${lines.join("\n")}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const dynamic = "force-dynamic";

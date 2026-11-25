import { llmsTxt } from "@/lib/llms";

// French llms.txt, served at /docs/fr/llms.txt.
export const GET = () => llmsTxt("fr");

export const dynamic = "force-dynamic";

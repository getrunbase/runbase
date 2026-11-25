import { llmsTxt } from "@/lib/llms";

// English llms.txt, served at /docs/llms.txt.
export const GET = () => llmsTxt("en");

export const dynamic = "force-dynamic";

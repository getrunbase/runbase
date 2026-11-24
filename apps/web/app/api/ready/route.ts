// Readiness: DB + Redis reachable, 503 otherwise (expected by the rollout).
import { readyHandler } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = readyHandler();

// Entry point of the `sandbox` container: runs functions
// for web and worker (SANDBOX_URL). Minimal env: SANDBOX_TOKEN, DENO_BIN,
// DENO_DIR; no DATABASE_URL, no REDIS_URL, no master key.
import { createSandboxServer } from "@getrunbase/core/functions/sandbox-server";

const port = Number(process.env.SANDBOX_PORT ?? 7200);
const server = createSandboxServer(process.env.SANDBOX_TOKEN ?? "");
server.listen(port, () => console.log(`[sandbox] listening on :${port}`));

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

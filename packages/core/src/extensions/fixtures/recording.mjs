// Test extension: each track() event is appended (one JSON per line)
// to the RUNBASE_EXTENSIONS_FIXTURE_OUT file, read by integration tests.
import { appendFileSync } from "node:fs";
import process from "node:process";

export default {
  telemetry: {
    track(event, props = {}) {
      const out = process.env.RUNBASE_EXTENSIONS_FIXTURE_OUT;
      if (out) appendFileSync(out, `${JSON.stringify({ event, props })}\n`);
    },
  },
  credentials: {
    oauthClient: async () => null,
  },
  client: {
    headScripts: async () => [{ id: "fixture", inline: "window.fixture = 1;" }],
  },
};

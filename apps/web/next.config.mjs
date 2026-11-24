import { fileURLToPath, URL } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

// i18n (next-intl): locale resolved in i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig = {
  transpilePackages: ["@runbase/core", "@getrunbase/node-sdk", "@runbase/ui"],
  // File attachment uploads (10 MB max on the service side).
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  serverExternalPackages: [
    "bullmq",
    "ioredis",
    "esbuild",
    "@tailwindcss/node",
    "@tailwindcss/oxide",
    "pino",
  ],
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // ponytail: typing is checked by `pnpm typecheck` in CI; the next build check diverges (dynamic import types).
  typescript: { ignoreBuildErrors: true },
};
export default withNextIntl(nextConfig);

import process from "node:process";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // In production the docs are served under getrunbase.com/docs next to another site:
  // assets go through /docs/_next (the proxy strips /docs). Empty in local dev.
  assetPrefix: process.env.DOCS_ASSET_PREFIX || undefined,
};

export default withMDX(config);

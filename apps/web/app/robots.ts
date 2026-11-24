import type { MetadataRoute } from "next";

// Self-hosted app behind sign-in: nothing to index.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Runbase",
    short_name: "Runbase",
    start_url: "/",
    display: "standalone",
    // The PWA manifest requires literal colours (no CSS variable).
    // eslint-disable-next-line no-restricted-syntax
    background_color: "#ffffff",
    // eslint-disable-next-line no-restricted-syntax
    theme_color: "#2f3037",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

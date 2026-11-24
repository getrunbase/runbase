import Script from "next/script";
import { getExtensions, type HeadScript } from "@getrunbase/core/extensions";
import { logger } from "@getrunbase/core/logger";

// Head scripts provided by an overlay, e.g. GA4 on the cloud
// after consent (handled by the script itself). None by default.
// A failing extension never breaks rendering.
export async function HeadScripts() {
  let scripts: HeadScript[];
  try {
    scripts = await getExtensions().client.headScripts();
  } catch (err) {
    logger.warn({ err }, "extension headScripts failed");
    return null;
  }
  return scripts.map(({ id, src, inline, attrs }) => (
    <Script
      key={id}
      {...attrs}
      {...{ id, src, strategy: "afterInteractive" as const }}
      {...(inline ? { dangerouslySetInnerHTML: { __html: inline } } : {})}
    />
  ));
}

// Fumadocs source: MDX pages of content/docs (written guides + generated references).
import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: pageSchema,
    // Languages unknown to Shiki (caddyfile…): rendered as plain text.
    mdxOptions: applyMdxPreset({
      rehypeCodeOptions: { fallbackLanguage: "plaintext" },
    }),
  },
  meta: { schema: metaSchema },
});

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

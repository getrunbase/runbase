// llms.txt (llmstxt.org): index of the docs pages of one language for AI
// agents and answer engines. Untranslated pages point to the English page.
import { i18n, type Lang } from "./i18n";
import { messages } from "./messages";
import { siteUrl } from "./site";
import { canonicalPath, source } from "./source";

export function llmsTxt(lang: Lang): Response {
  const t = messages(lang);
  const lines = source
    .getPages(lang)
    .map(
      (p) =>
        `- [${p.data.title}](${siteUrl()}${canonicalPath(p.slugs, lang)})${p.data.description ? `: ${p.data.description}` : ""}`,
    );
  const others = i18n.languages
    .filter((l) => l !== lang)
    .map((l) => `- [${messages(l).languageName}](${siteUrl()}${llmsPath(l)})`);
  const body = `# ${t.meta.title}\n\n> ${t.meta.description}\n\n## ${t.llms.pages}\n\n${lines.join("\n")}\n\n## ${t.llms.otherLanguages}\n\n${others.join("\n")}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const llmsPath = (lang: Lang) =>
  lang === i18n.defaultLanguage ? "/docs/llms.txt" : `/docs/${lang}/llms.txt`;

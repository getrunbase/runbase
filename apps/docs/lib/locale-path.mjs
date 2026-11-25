// Public URLs of the docs per language. English (default) has no prefix,
// French lives under /docs/fr (and /fr for the home page). Internally
// every page is rendered under app/[lang]: /docs/x -> /en/docs/x,
// /docs/fr/x -> /fr/docs/x (rewrite in proxy.ts).

export const LANGUAGES = ["en", "fr"];
export const DEFAULT_LANGUAGE = "en";

const prefix = (lang) => (lang === DEFAULT_LANGUAGE ? "" : `/${lang}`);

// Public URL of a docs page: docsPath("fr", ["concepts"]) -> /docs/fr/concepts.
export function docsPath(lang, slugs = []) {
  const rest = slugs.filter(Boolean).map((s) => `/${s}`).join("");
  return `/docs${prefix(lang)}${rest}`;
}

// Public URL of the home page.
export const homePath = (lang) => prefix(lang) || "/";

// Language of a public path.
export function langOf(pathname) {
  const m = pathname.match(/^(?:\/docs)?\/([a-z]{2})(?=\/|$)/);
  return m && LANGUAGES.includes(m[1]) ? m[1] : DEFAULT_LANGUAGE;
}

// Same page in another language (language switcher).
export function switchLanguage(pathname, lang) {
  const re = new RegExp(`^(/docs)?/(${LANGUAGES.join("|")})(?=/|$)`);
  const bare = pathname.replace(re, (_, docs = "") => docs) || "/";
  if (lang === DEFAULT_LANGUAGE) return bare;
  if (bare === "/docs" || bare.startsWith("/docs/"))
    return `/docs/${lang}${bare.slice(5)}`;
  return `/${lang}${bare === "/" ? "" : bare}`;
}

// Docs link written in an MDX page (`/docs/x#y`), made to point to the
// same page in the page's language. Translations keep English links.
export function localizeHref(href, lang) {
  if (lang === DEFAULT_LANGUAGE || typeof href !== "string") return href;
  const m = href.match(/^\/docs(?=[/#?]|$)(.*)$/);
  if (!m || langOf(href) !== DEFAULT_LANGUAGE || m[1].startsWith("/api/"))
    return href;
  return `/docs/${lang}${m[1]}`;
}

// Proxy routing of a public path: { rewrite } to the internal path,
// { redirect } to the canonical public path, or null (served as is).
export function route(pathname) {
  let m = pathname.match(/^\/docs(?:\/([a-z]{2})(?=\/|$))?(\/.*)?$/);
  if (m && (!m[1] || LANGUAGES.includes(m[1]))) {
    const [, lang, rest = ""] = m;
    if (lang === DEFAULT_LANGUAGE) return { redirect: `/docs${rest}` };
    return { rewrite: `/${lang ?? DEFAULT_LANGUAGE}/docs${rest}` };
  }
  m = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  if (m && LANGUAGES.includes(m[1])) {
    // Internal path typed by hand: send it to its public URL.
    const [, lang, rest = ""] = m;
    if (rest === "/docs" || rest.startsWith("/docs/"))
      return { redirect: `/docs${prefix(lang)}${rest.slice(5)}` };
    if (lang === DEFAULT_LANGUAGE) return { redirect: rest || "/" };
    return null;
  }
  return { rewrite: `/${DEFAULT_LANGUAGE}${pathname === "/" ? "" : pathname}` };
}

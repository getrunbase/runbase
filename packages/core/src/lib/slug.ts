// Single slug helper shared by the core and the web app. Every key, id or
// URL fragment derived from free text goes through here so that the client
// and the server always agree on the result.

/** Lowercases and strips diacritics ("Éclair" -> "eclair"). */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export type SlugOptions = {
  /** Separator between words. Defaults to "_". */
  separator?: "_" | "-";
  /** Returned when the slug would otherwise be empty. Defaults to "". */
  fallback?: string;
  /** Drop leading digits so the result is a valid identifier. */
  startWithLetter?: boolean;
};

/**
 * Turns free text into a lowercase ASCII slug: accents removed, every run of
 * non-alphanumeric characters replaced by the separator, separators trimmed.
 */
export function slugify(s: string, options: SlugOptions = {}): string {
  const sep = options.separator ?? "_";
  let out = foldAccents(s)
    .replace(/[^a-z0-9]+/g, sep)
    .replace(sep === "-" ? /^-+|-+$/g : /^_+|_+$/g, "");
  if (options.startWithLetter) out = out.replace(/^[^a-z]+/, "");
  return out || (options.fallback ?? "");
}

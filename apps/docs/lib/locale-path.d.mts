export const LANGUAGES: string[];
export const DEFAULT_LANGUAGE: string;
export function docsPath(lang: string, slugs?: string[]): string;
export function homePath(lang: string): string;
export function langOf(pathname: string): string;
export function switchLanguage(pathname: string, lang: string): string;
export function localizeHref<T>(href: T, lang: string): T;
export function route(
  pathname: string,
): { rewrite: string } | { redirect: string } | null;

// Page icon: lucide name stored in kebab-case ("layout-dashboard").
// Also accepts PascalCase ("LayoutDashboard"); refuses an unknown name.
// Not `lucide-react/dynamic`: "use client" module, unusable server-side.
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { appError } from "../errors/app-error";

export const DEFAULT_PAGE_ICON = "layout-dashboard";
const known = new Set<string>(Object.keys(dynamicIconImports));

export function toIconName(raw: string): string | null {
  const kebab = raw
    .trim()
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
  return known.has(kebab) ? kebab : null;
}

export function parseIcon(raw: string): string {
  const name = toIconName(raw);
  if (!name)
    throw appError(
      "pages.unknownIcon",
      'Unknown lucide icon: {icon} (e.g. "users", "shopping-cart", see lucide.dev/icons)',
      { icon: raw },
    );
  return name;
}

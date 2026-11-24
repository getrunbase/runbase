import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";

// Cursor pagination: "Older" keeps the URL filters,
// "Newer" goes back to the first page.
export function Pager({
  params,
  nextCursor,
}: {
  params: Record<string, string | undefined>;
  nextCursor: string | null;
}) {
  const t = useTranslations("common.pager");
  const { cursor, ...rest } = params;
  if (!cursor && !nextCursor) return null;
  const href = (c?: string) => {
    const s = new URLSearchParams(
      Object.entries({ ...rest, cursor: c }).filter(
        (e): e is [string, string] => !!e[1],
      ),
    );
    return `?${s}`;
  };
  return (
    <div className="flex justify-end gap-2">
      {cursor && (
        <Button asChild variant="outline" size="sm">
          <Link href={href()}>{t("newer")}</Link>
        </Button>
      )}
      {nextCursor && (
        <Button asChild variant="outline" size="sm">
          <Link href={href(nextCursor)}>{t("older")}</Link>
        </Button>
      )}
    </div>
  );
}

"use client";
// Builder actions in the header (never seen by end
// users nor in captures): draft, preview, publication, history.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon, SendIcon, Undo2Icon } from "lucide-react";
import { Badge } from "@runbase/ui/components/ui/badge";
import { Button } from "@runbase/ui/components/ui/button";
import { VersionHistory } from "@/components/version-history";
import { TopbarActions } from "@/components/topbar-actions";
import { discardDraft, pageHistory, publishPage, restorePage } from "./actions";

export function BuilderBar({
  id,
  current,
  draft,
  preview,
}: {
  id: string;
  // Published version (null: never published).
  current: number | null;
  // Draft differs from the published one.
  draft: boolean;
  // Draft preview shown.
  preview: boolean;
}) {
  const t = useTranslations("pages.builder");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, href?: string) =>
    start(async () => {
      await fn();
      if (href) router.push(href);
      router.refresh();
    });
  const base = `/p/${encodeURIComponent(id)}`;
  // Everything in the header: nothing shows on the page itself, and only
  // the history remains when no draft is pending.
  return (
    <TopbarActions>
      {draft && <Badge variant="secondary">{t("unpublishedDraft")}</Badge>}
      {draft && !preview && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={`${base}?draft=1`}>
            <EyeIcon />
            {t("viewDraft")}
          </Link>
        </Button>
      )}
      {preview && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={base}>{t("viewLive")}</Link>
        </Button>
      )}
      {draft && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => discardDraft(id), base)}
        >
          <Undo2Icon />
          {t("discard")}
        </Button>
      )}
      <VersionHistory
        current={current ?? 0}
        load={() => pageHistory(id)}
        restore={(v) => restorePage(id, v)}
      />
      {draft && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => publishPage(id), base)}
        >
          <SendIcon />
          {t("publish")}
        </Button>
      )}
    </TopbarActions>
  );
}

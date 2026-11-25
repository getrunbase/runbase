"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { useErrorText } from "@/lib/error-text";
import { createWorkspace } from "../../actions";

// New workspace. limit set = cap reached: disabled with an explanation
// and, when the host has a billing page, a link to upgrade.
export function CreateWorkspaceForm({
  limit,
  upgradeHref,
}: {
  limit: number | null;
  upgradeHref: string | null;
}) {
  const t = useTranslations("settings.general.workspaces");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState(createWorkspace, undefined);
  const blocked = limit != null;
  return (
    <div className="flex flex-col gap-2">
      <form action={action} className="flex gap-2">
        <Input
          name="name"
          placeholder={t("newPlaceholder")}
          required
          disabled={blocked}
        />
        <Button type="submit" disabled={blocked || pending}>
          {tc("create")}
        </Button>
      </form>
      {blocked && (
        <p className="text-muted-foreground text-sm">
          {upgradeHref ? t("limitUpgrade", { max: limit }) : t("limit", { max: limit })}{" "}
          {upgradeHref && (
            <Link href={upgradeHref} className="text-foreground underline">
              {t("upgrade")}
            </Link>
          )}
        </p>
      )}
      {state?.error && (
        <p className="text-destructive text-sm">{errorText(state.error)}</p>
      )}
    </div>
  );
}

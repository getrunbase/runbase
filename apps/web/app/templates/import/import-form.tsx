"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@getrunbase/ui/components/ui/button";
import { useErrorText } from "@/lib/error-text";
import type { ImportTemplateResult } from "../../databases/actions";
import { importCatalogTemplate } from "./actions";

export function CatalogImportForm({ template }: { template: string }) {
  const t = useTranslations("databases");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<
    ImportTemplateResult | null,
    FormData
  >(importCatalogTemplate, null);
  if (state?.done)
    return (
      <div className="space-y-3">
        <Alert>
          <AlertTitle>
            {t("import.done", {
              name: state.done.name,
              count: state.done.objects,
            })}
          </AlertTitle>
          {state.done.missingSecrets.length > 0 && (
            <AlertDescription>
              {t("import.missingSecrets", {
                names: state.done.missingSecrets.join(", "),
              })}
            </AlertDescription>
          )}
        </Alert>
        <Button asChild>
          <Link href="/databases">{t("catalogImport.open")}</Link>
        </Button>
      </div>
    );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="template" value={template} />
      <Button type="submit" disabled={pending} className="w-full p-3">
        <Download />
        {pending ? t("import.importing") : t("import.submit")}
      </Button>
      {state?.error && (
        <Alert variant="destructive">
          <AlertTitle>{t("import.failed")}</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {errorText(state.error)}
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}

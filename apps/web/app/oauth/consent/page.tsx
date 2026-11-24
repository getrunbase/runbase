// MCP OAuth flow: consent to the scopes requested by the client.
import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { OAuthCard } from "../oauth-card";
import { ConsentButtons } from "./consent-buttons";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("oauthConsent");

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; scope?: string }>;
}) {
  const { client_id, scope } = await searchParams;
  const t = await getTranslations("auth.oauth");
  const scopes = (scope ?? "").split(" ").filter(Boolean);
  return (
    <OAuthCard
      title={t("heading", { client: client_id ?? t("unknownClient") })}
      description={t("intro")}
    >
      {scopes.length > 0 && (
        <div className="flex w-full flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">
            {t("permissions")}
          </p>
          {scopes.map((s) => (
            <div key={s} className="flex w-full gap-3">
              <Check className="size-4 shrink-0 text-tag-green-fg" />
              <span className="flex-1 text-sm font-medium text-foreground">
                {s}
              </span>
            </div>
          ))}
        </div>
      )}
      <ConsentButtons />
      <p className="w-full text-center text-xs text-subtle-foreground">
        {t("revoke")}
      </p>
    </OAuthCard>
  );
}

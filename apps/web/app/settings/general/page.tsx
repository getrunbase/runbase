import { workspacesService } from "@getrunbase/core/workspaces";
import { runsService } from "@getrunbase/core/runs";
import { billingService, quotasService } from "@getrunbase/core/quotas";
import { Check } from "lucide-react";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Button } from "@getrunbase/ui/components/ui/button";
import { getFormatter, getTranslations } from "next-intl/server";
import { Input } from "@getrunbase/ui/components/ui/input";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { isOrgAdmin } from "@/lib/settings-access";
import { ConfirmAction } from "@/components/confirm-action";
import { ConnectAgent } from "@/components/connect-agent";
import {
  deleteWorkspace,
  renameWorkspace,
  setLimits,
  setAiBudget,
  switchWorkspace,
} from "../../actions";
import { appUrl } from "@getrunbase/core/env";
import { SettingsPage, SettingsSection } from "../settings-shell";
import { aiSettingsService } from "@getrunbase/core/ai-providers";
import { secretsService } from "@getrunbase/core/secrets";
import { AiProviderForm } from "./ai-provider-form";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { workspaceCount } from "@getrunbase/core/workspaces";
import { quotaOf } from "@getrunbase/core/entitlements";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("general");

const LIMITS = [
  "records",
  "runsPerMinute",
  "apiPerMinute",
  "concurrency",
] as const;

// Workspace settings (DNCwy board): workspaces, AI budget, limits, MCP, danger zone.
export default async function Settings() {
  const { ctx, role } = await getTenant();
  if (!isOrgAdmin(role)) notFound();
  const t = await getTranslations("settings.general");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const usd = (n: number, max = 2) =>
    format.number(n, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: max,
    });
  // Member and limit management: admins only.
  const isAdmin = role === "owner" || role === "admin";
  const mcpUrl = `${appUrl()}/api/mcp`;
  const list = await workspacesService.list(ctx);
  // Workspace cap reached: the create form is disabled up front.
  const [wsMax, wsUsed] = await Promise.all([
    quotaOf(ctx.organizationId, "quota:workspaces"),
    workspaceCount(ctx),
  ]);
  const wsLimit = wsUsed >= wsMax ? wsMax : null;
  const [budget, quotas, ai, secrets] = await Promise.all([
    runsService.budget(ctx),
    quotasService.get(ctx),
    aiSettingsService.get(ctx),
    secretsService.list(ctx),
  ]);
  return (
    <SettingsPage isAdmin={isAdmin}>
      <div id="workspaces" className="scroll-mt-20">
        <SettingsSection
          title={t("workspaces.title")}
          description={t("workspaces.description")}
        >
          {list.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2">
              <form
                action={renameWorkspace}
                className="flex min-w-full flex-1 gap-2 sm:min-w-0"
              >
                <input type="hidden" name="id" value={w.id} />
                <Input
                  name="name"
                  defaultValue={w.name}
                  aria-label={tc("name")}
                />
                <Button type="submit" variant="secondary">
                  {t("workspaces.rename")}
                </Button>
              </form>
              <form action={switchWorkspace}>
                <input type="hidden" name="id" value={w.id} />
                <Button
                  type="submit"
                  variant={w.id === ctx.workspaceId ? "default" : "secondary"}
                  disabled={w.id === ctx.workspaceId}
                >
                  {w.id === ctx.workspaceId && <Check />}
                  {w.id === ctx.workspaceId
                    ? t("workspaces.active")
                    : t("workspaces.select")}
                </Button>
              </form>
            </div>
          ))}
          <CreateWorkspaceForm
            limit={wsLimit}
            upgradeHref={billingService.enabled() ? "/settings/billing" : null}
          />
        </SettingsSection>
      </div>

      <SettingsSection
        title={t("budget.title")}
        description={t("budget.description")}
      >
        <p className="text-foreground text-sm">
          {t("budget.spent", { spent: usd(budget.spentUsd, 4) })}
          {budget.budgetUsd != null &&
            t("budget.ofBudget", { budget: usd(budget.budgetUsd) })}
          {budget.exhausted && t("budget.exhausted")}
        </p>
        <form action={setAiBudget} className="flex gap-2">
          <Input
            name="budget"
            type="number"
            min="0.01"
            step="0.01"
            placeholder={t("budget.unlimited")}
            defaultValue={budget.budgetUsd ?? ""}
            aria-label={t("budget.ariaLabel")}
          />
          <Button type="submit">
            <Check />
            {tc("save")}
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title={t("ai.title")} description={t("ai.description")}>
        <AiProviderForm
          presets={aiSettingsService.presets().map((p) => ({
            id: p.id,
            label: p.label,
            models: p.models.map((m) => ({ id: m.id, label: m.label })),
            keySecret: p.keySecret,
          }))}
          provider={ai.provider}
          model={ai.model}
          keySecret={ai.keySecret}
          keys={secrets.map((s) => s.name)}
          disabled={!isAdmin}
        />
      </SettingsSection>

      <SettingsSection
        title={t("limits.title")}
        description={t("limits.description")}
      >
        <form action={setLimits} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {LIMITS.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`limit-${key}`}>{t(`limits.${key}`)}</Label>
                <Input
                  id={`limit-${key}`}
                  name={key}
                  type="number"
                  min="1"
                  step="1"
                  placeholder={format.number(quotas.defaults[key])}
                  defaultValue={
                    quotas.limits[key] !== quotas.defaults[key]
                      ? quotas.limits[key]
                      : ""
                  }
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            {t("limits.usage", {
              used: format.number(quotas.usage.records),
              limit: format.number(quotas.limits.records),
            })}
          </p>
          {isAdmin && (
            <div className="flex justify-end gap-2">
              <Button type="submit">
                <Check />
                {tc("save")}
              </Button>
            </div>
          )}
        </form>
      </SettingsSection>

      <SettingsSection
        title={t("mcp.title")}
        description={t("mcp.description")}
      >
        <ConnectAgent mcpUrl={mcpUrl} />
      </SettingsSection>

      <SettingsSection
        title={t("danger.title")}
        description={t("danger.description")}
        danger
      >
        <div className="outline-tag-red-bg flex flex-col rounded-lg outline -outline-offset-1">
          {list.map((w) => (
            <div
              key={w.id}
              className="border-tag-red-bg flex items-center gap-4 border-b p-4 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-foreground text-sm font-medium">
                  {t("danger.deleteTitle", { name: w.name })}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("danger.deleteHint")}
                </p>
              </div>
              <ConfirmAction
                action={deleteWorkspace}
                fields={{ id: w.id }}
                label={t("danger.delete")}
                title={t("workspaces.deleteTitle", { name: w.name })}
                description={t("workspaces.deleteDescription")}
                confirmLabel={t("workspaces.deleteConfirm")}
                disabled={list.length <= 1}
              />
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}

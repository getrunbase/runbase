"use client";

import { createContext, useContext, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Label } from "@getrunbase/ui/components/ui/label";
import {
  NewSecretDialog,
  SecretSelect,
  useSecretNames,
} from "@/components/secret-select";
import { Choice } from "./step-form-fields";

// AI presets (provider, models, default key secret), from the server page.
export type AiPresetInfo = {
  id: string;
  label: string;
  models: { id: string; label: string }[];
  keySecret: string;
};
const Ctx = createContext<AiPresetInfo[]>([]);
export const AiPresetsProvider = ({
  presets,
  children,
}: {
  presets: AiPresetInfo[];
  children: React.ReactNode;
}) => <Ctx.Provider value={presets}>{children}</Ctx.Provider>;

export type BlockAiValue = { provider: string; model?: string; secret?: string };

// Per-block AI config: provider, model and the key picked from the
// workspace secrets (never typed here). No secret yet: empty state with
// a dialog that creates it, then selects it.
export function AiBlockConfig({
  value,
  onChange,
}: {
  value?: BlockAiValue;
  onChange: (v: BlockAiValue | undefined) => void;
}) {
  const t = useTranslations("workflows.stepForm.ai");
  const presets = useContext(Ctx);
  const names = useSecretNames();
  const [added, setAdded] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);
  const p = presets.find((x) => x.id === value?.provider);
  const secrets = [...new Set([...names, ...added])];
  // Provider's default secret when it exists, otherwise the only one.
  const guess = (x: AiPresetInfo) =>
    secrets.includes(x.keySecret)
      ? x.keySecret
      : secrets.length === 1
        ? secrets[0]
        : undefined;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label>{t("provider")}</Label>
        <Choice
          value={value?.provider}
          placeholder={t("providerPlaceholder")}
          options={presets.map((x) => ({ value: x.id, label: x.label }))}
          onChange={(id) => {
            const x = presets.find((y) => y.id === id)!;
            onChange({
              provider: id,
              model: x.models[0]?.id,
              secret: value?.secret ?? guess(x),
            });
          }}
        />
        {!value && (
          <p className="text-muted-foreground text-xs">{t("fallback")}</p>
        )}
      </div>
      {p && value && (
        <>
          <div className="space-y-1">
            <Label>{t("model")}</Label>
            <Choice
              value={value.model ?? p.models[0]?.id}
              options={p.models.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(model) => onChange({ ...value, model })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("key")}</Label>
            {secrets.length ? (
              <SecretSelect
                value={value.secret ?? ""}
                secrets={secrets}
                defaultNewName={p.keySecret}
                onChange={(secret) => onChange({ ...value, secret })}
              />
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-3">
                <p className="text-muted-foreground text-sm">
                  {t("noSecret")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog(true)}
                >
                  <Plus /> {t("addKey")}
                </Button>
              </div>
            )}
            <NewSecretDialog
              open={dialog}
              onOpenChange={setDialog}
              defaultName={p.keySecret}
              onCreated={(n) => {
                setAdded((a) => [...a, n]);
                onChange({ ...value, secret: n });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

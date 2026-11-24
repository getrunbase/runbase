"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SecretSelect } from "@/components/secret-select";
import { useErrorText } from "@/lib/error-text";
import { setAiProvider } from "./ai-actions";

type Preset = {
  id: string;
  label: string;
  models: { id: string; label: string }[];
  keySecret: string;
};

// AI provider choice: list, key (never read back), model picked from the list.
export function AiProviderForm({
  presets,
  provider,
  model,
  keySecret,
  keys,
  disabled,
}: {
  presets: Preset[];
  provider: string | null;
  model: string;
  keySecret: string;
  keys: string[];
  disabled: boolean;
}) {
  const t = useTranslations("settings.general.ai");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState(setAiProvider, undefined);
  // No provider preselected: the person chooses their AI.
  const [id, setId] = useState(provider ?? "");
  const p = presets.find((x) => x.id === id);
  // Referenced secret (by name); switching provider restores its default.
  const [secret, setSecret] = useState(keySecret);
  const hasKey = keys.includes(secret);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-provider">{t("provider")}</Label>
          <Select
            name="provider"
            value={id}
            onValueChange={(v) => {
              setId(v);
              setSecret(
                v === provider
                  ? keySecret
                  : (presets.find((x) => x.id === v)?.keySecret ?? secret),
              );
            }}
            disabled={disabled}
          >
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue placeholder={t("providerPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {presets.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-model">{t("model")}</Label>
          <Select
            key={id}
            name="model"
            defaultValue={id === provider ? model : p?.models[0]?.id}
            disabled={disabled || !p}
          >
            <SelectTrigger id="ai-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {p?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-key-secret">{t("keySecret")}</Label>
        <SecretSelect
          id="ai-key-secret"
          name="keySecret"
          value={secret}
          onChange={setSecret}
          secrets={keys}
          defaultNewName={p?.keySecret ?? ""}
          disabled={disabled || !p}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-key">{t("key")}</Label>
        <Input
          id="ai-key"
          name="key"
          type="password"
          autoComplete="off"
          placeholder={hasKey ? t("keySet") : t("keyPlaceholder")}
          disabled={disabled || !p}
        />
        {p && (
          <p className="text-muted-foreground text-sm">
            {hasKey ? t("keyHint", { secret }) : t("noKeyHint", { secret })}
          </p>
        )}
      </div>
      {state?.error && (
        <p className="text-destructive text-sm">{errorText(state.error)}</p>
      )}
      {!disabled && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || !p}>
            <Check />
            {t("save")}
          </Button>
        </div>
      )}
    </form>
  );
}

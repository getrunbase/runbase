"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Radio } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { ObjectInfo } from "../graph";
import { webhookSample } from "../actions";
import { jsonPaths, pickPath } from "../webhook";
import { ObjectPicker } from "./pickers";

export type WebhookInfo = {
  id: string;
  name: string;
  sample: unknown;
  sampleAt: string | null;
};

const NONE = "__none";
// JSON sample (code, not translated).
const SAMPLE_PLACEHOLDER = '{"payload": {"attendees": [{"email": "…"}]}}';

// "Webhook received" trigger: each valid delivery starts the workflow.
// Payload sample: listening for a provider test, paste, or the last one
// received; its paths map to the object fields.
export function WebhookTriggerForm({
  value,
  onChange,
  objects,
  webhooks,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  objects: ObjectInfo[];
  webhooks: WebhookInfo[];
}) {
  const t = useTranslations("workflows");
  const hook = webhooks.find((w) => w.name === value.webhook);
  const object = objects.find((o) => o.slug === value.object);
  const mapping = (value.mapping as Record<string, string> | undefined) ?? {};
  const [sample, setSample] = useState<unknown>(hook?.sample ?? null);
  const [pasted, setPasted] = useState("");
  const [listening, setListening] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setSample(hook?.sample ?? null), [hook]);

  // Listening: polls the last received payload every 2 s (2 min max).
  useEffect(() => {
    if (!listening || !hook) return;
    const since = hook.sampleAt;
    let n = 0;
    const timer = setInterval(async () => {
      const r = (await webhookSample(hook.name)).data;
      if (r?.at && r.at !== since) {
        setSample(r.sample);
        setListening(false);
      } else if (++n > 60) setListening(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [listening, hook]);

  const paths = jsonPaths(sample);
  const url = hook ? `${origin}/api/hooks/${hook.id}` : "";
  const testUrl = hook ? `${url}/test` : "";
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <Label>{t("webhook.label")}</Label>
      {webhooks.length ? (
        <Select value={hook?.name} onValueChange={(w) => set({ webhook: w })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("webhook.choose")} />
          </SelectTrigger>
          <SelectContent>
            {webhooks.map((w) => (
              <SelectItem key={w.id} value={w.name}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("webhook.none", { tool: "webhooks.create" })}
        </p>
      )}
      {hook && (
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("webhook.copyUrl")}
            onClick={() => navigator.clipboard.writeText(url)}
          >
            <Copy />
          </Button>
        </div>
      )}

      {hook && (
        <>
          <Label>{t("webhook.sample")}</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setListening(!listening)}
            >
              {listening ? <Spinner /> : <Radio />}
              {listening ? t("webhook.listening") : t("webhook.listen")}
            </Button>
          </div>
          {listening && (
            <div className="flex gap-2">
              <Input readOnly value={testUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("webhook.copyTestUrl")}
                onClick={() => navigator.clipboard.writeText(testUrl)}
              >
                <Copy />
              </Button>
            </div>
          )}
          <p className="text-muted-foreground text-xs">{t("webhook.help")}</p>
          <Textarea
            placeholder={SAMPLE_PLACEHOLDER}
            className="font-mono text-xs"
            rows={3}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              try {
                setSample(JSON.parse(e.target.value));
              } catch {
                /* Incomplete JSON: keep the previous sample */
              }
            }}
          />
          {sample != null && (
            <p className="text-muted-foreground text-xs">
              {t("webhook.detected", { count: paths.length })}
            </p>
          )}

          <Label>{t("webhook.upsert")}</Label>
          <ObjectPicker
            value={value.object as string | undefined}
            objects={objects}
            onChange={(o) => set({ object: o, match: undefined, mapping: {} })}
          />
        </>
      )}

      {hook && object && (
        <>
          <Label>{t("webhook.dedupKey")}</Label>
          <Select
            value={(value.match as string | undefined) ?? NONE}
            onValueChange={(m) => set({ match: m === NONE ? undefined : m })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("webhook.noDedup")}</SelectItem>
              {object.fields
                .filter((f) => f.unique)
                .map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Label>{t("webhook.mapping")}</Label>
          <div className="space-y-2">
            {object.fields.map((f) => {
              const path = mapping[f.key];
              const preview = path ? pickPath(sample, path) : undefined;
              return (
                <div
                  key={f.key}
                  className="grid grid-cols-2 items-center gap-2"
                >
                  <span className="truncate text-sm">{f.label}</span>
                  <Select
                    value={path ?? NONE}
                    onValueChange={(p) => {
                      const next = { ...mapping };
                      if (p === NONE) delete next[f.key];
                      else next[f.key] = p;
                      set({ mapping: next });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {[...new Set([...paths, ...(path ? [path] : [])])].map(
                        (p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  {preview !== undefined && (
                    <span className="text-muted-foreground col-start-2 truncate text-xs">
                      {JSON.stringify(preview)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("webhook.runsOn", { code: "{{event.…}}" })}
          </p>
        </>
      )}
    </div>
  );
}

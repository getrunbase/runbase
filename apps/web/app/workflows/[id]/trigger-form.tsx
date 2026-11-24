"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@getrunbase/ui/components/ui/badge";
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
import type { ObjectInfo } from "../graph";
import { makeLabels } from "../labels";
import { WebhookTriggerForm, type WebhookInfo } from "./webhook-trigger";
import { ObjectPicker } from "./pickers";
import { ScheduleForm } from "./schedule-form";

// Time zones offered for scheduling (local time of the due date).
const TIMEZONES = [
  "UTC",
  "Europe/Paris",
  "Europe/London",
  "Europe/Brussels",
  "Europe/Zurich",
  "America/New_York",
  "America/Los_Angeles",
  "America/Montreal",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const ALL = "__all";

const TRIGGERS = [
  "trigger.manual",
  "trigger.record_created",
  "trigger.record_updated",
  "trigger.event",
  "trigger.schedule",
  "trigger.webhook",
  "trigger.run_failed",
];

export function TriggerForm({
  value,
  onChange,
  objects,
  events,
  webhooks,
  workflows,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  objects: ObjectInfo[];
  events: string[];
  webhooks: WebhookInfo[];
  workflows: { id: string; name: string }[];
}) {
  const t = useTranslations("workflows");
  const l = makeLabels(t);
  const type = String(value.type);
  const object = objects.find((o) => o.slug === value.object);
  return (
    <div className="space-y-3">
      <Label>{t("trigger.label")}</Label>
      <Select
        value={type}
        onValueChange={(v) =>
          onChange({
            type: v,
            ...(value.object ? { object: value.object } : {}),
          })
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TRIGGERS.map((tr) => (
            <SelectItem key={tr} value={tr}>
              {l.trigger(tr)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {type === "trigger.webhook" && (
        <WebhookTriggerForm
          value={value}
          onChange={onChange}
          objects={objects}
          webhooks={webhooks}
        />
      )}
      {type === "trigger.run_failed" && (
        <>
          <Label>{t("trigger.watchedWorkflow")}</Label>
          <Select
            value={(value.workflow as string | undefined) ?? ALL}
            onValueChange={(w) =>
              onChange({ type, ...(w !== ALL && { workflow: w }) })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("trigger.allWorkflows")}</SelectItem>
              {workflows.map((w) => (
                <SelectItem key={w.id} value={w.name}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t("trigger.runFailedHelp")}
          </p>
        </>
      )}
      {type !== "trigger.event" &&
        type !== "trigger.webhook" &&
        type !== "trigger.run_failed" && (
          <>
            <Label>{t("trigger.object")}</Label>
            <ObjectPicker
              value={value.object as string | undefined}
              objects={objects}
              onChange={(o) => onChange({ ...value, object: o })}
            />
            <p className="text-muted-foreground text-xs">
              {type === "trigger.schedule"
                ? value.object
                  ? t("trigger.scheduleWithObject")
                  : t("trigger.scheduleWithoutObject")
                : t("trigger.objectHelp")}
            </p>
            {type === "trigger.schedule" && !!value.object && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...value, object: undefined })}
              >
                {t("trigger.runOnce")}
              </Button>
            )}
          </>
        )}
      {type === "trigger.record_updated" && object && (
        <>
          <Label>{t("trigger.watchedFields")}</Label>
          <div className="flex flex-wrap gap-1">
            {object.fields.map((f) => {
              const fields = (value.fields as string[] | undefined) ?? [];
              const on = fields.includes(f.key);
              return (
                <Badge key={f.key} asChild variant={on ? "default" : "outline"}>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        fields: on
                          ? fields.filter((k) => k !== f.key)
                          : [...fields, f.key],
                      })
                    }
                  >
                    {f.label}
                  </button>
                </Badge>
              );
            })}
          </div>
        </>
      )}
      {type === "trigger.event" && (
        <>
          <Label>{t("trigger.eventName")}</Label>
          <Input
            placeholder={t("trigger.eventPlaceholder")}
            value={String(value.event ?? "")}
            onChange={(e) => onChange({ type, event: e.target.value })}
          />
          {events.length > 0 && (
            <>
              <p className="text-muted-foreground text-xs">
                {t("trigger.eventsSeen")}
              </p>
              <div className="flex flex-wrap gap-1">
                {events.map((e) => (
                  <Badge
                    key={e}
                    asChild
                    variant={value.event === e ? "default" : "outline"}
                  >
                    <button
                      type="button"
                      onClick={() => onChange({ type, event: e })}
                    >
                      {e}
                    </button>
                  </Badge>
                ))}
              </div>
            </>
          )}
          <p className="text-muted-foreground text-xs">
            {t("trigger.eventHelp")}
          </p>
        </>
      )}
      {type === "trigger.schedule" && (
        <>
          <Label>{t("trigger.when")}</Label>
          <ScheduleForm
            cron={value.cron as string | undefined}
            onChange={(cron) => onChange({ ...value, cron })}
          />
          <Label>{t("trigger.timezone")}</Label>
          <Select
            value={(value.timezone as string | undefined) ?? "UTC"}
            onValueChange={(tz) =>
              onChange({ ...value, timezone: tz === "UTC" ? undefined : tz })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ...new Set([
                  ...TIMEZONES,
                  ...(value.timezone ? [String(value.timezone)] : []),
                ]),
              ].map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz === "UTC" ? t("trigger.utc") : tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}

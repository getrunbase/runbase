"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Input } from "@getrunbase/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SCHEDULE,
  describe,
  fromCron,
  toCron,
  WEEKDAYS,
  type Schedule,
} from "../schedule";

const FREQS: Schedule["freq"][] = ["daily", "monthly", "hourly", "custom"];

const pad = (n: number) => String(n).padStart(2, "0");

// Schedule without cron: frequency, days, time; the cron is generated.
export function ScheduleForm({
  cron,
  onChange,
}: {
  cron?: string;
  onChange: (cron: string) => void;
}) {
  const t = useTranslations("workflows");
  const parsed = fromCron(cron);
  // Advanced mode kept locally: a simple cron typed by hand would
  // otherwise be read back as "Some days" and the editor would restart from the form.
  const [advanced, setAdvanced] = useState(parsed.freq === "custom");
  const s: Schedule = advanced
    ? { freq: "custom", cron: cron ?? toCron(parsed) }
    : parsed;
  const set = (next: Schedule) => onChange(toCron(next));
  const hour = "hour" in s ? s.hour : 9;
  const minute = "minute" in s ? s.minute : 0;
  const switchTo = (freq: Schedule["freq"]) => {
    setAdvanced(freq === "custom");
    // Back to the form from a non-simple cron: default values.
    if (freq === s.freq || (freq !== "custom" && parsed.freq === freq)) return;
    set(
      freq === "daily"
        ? DEFAULT_SCHEDULE
        : freq === "monthly"
          ? { freq, day: 1, hour, minute }
          : freq === "hourly"
            ? { freq, minute }
            : { freq, cron: toCron(s) },
    );
  };
  return (
    <div className="space-y-3">
      <Select
        value={s.freq}
        onValueChange={(f) => switchTo(f as Schedule["freq"])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FREQS.map((f) => (
            <SelectItem key={f} value={f}>
              {t(`schedule.freq.${f}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {s.freq === "daily" && (
        <div className="flex gap-1">
          {WEEKDAYS.map((d) => {
            const on = s.days.includes(d);
            return (
              <Badge
                key={d}
                asChild
                variant={on ? "default" : "outline"}
                className="size-8 justify-center"
              >
                <button
                  type="button"
                  aria-label={t(`schedule.days.d${d}`)}
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      ...s,
                      days: on ? s.days.filter((x) => x !== d) : [...s.days, d],
                    })
                  }
                >
                  {t(`schedule.short.d${d}`)}
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      {s.freq === "monthly" && (
        <div className="flex items-center gap-2 text-sm">
          {t("schedule.form.monthlyBefore")}
          <Input
            type="number"
            min={1}
            max={28}
            aria-label={t("schedule.form.dayOfMonth")}
            className="w-20"
            value={s.day}
            onChange={(e) =>
              set({
                ...s,
                day: Math.min(28, Math.max(1, Number(e.target.value) || 1)),
              })
            }
          />
          {t("schedule.form.monthlyAfter")}
        </div>
      )}
      {(s.freq === "daily" || s.freq === "monthly") && (
        <div className="flex items-center gap-2 text-sm">
          {t("schedule.form.at")}
          <Input
            type="time"
            aria-label={t("schedule.form.hour")}
            className="w-32"
            value={`${pad(s.hour)}:${pad(s.minute)}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (h !== undefined && m !== undefined)
                set({ ...s, hour: h, minute: m });
            }}
          />
        </div>
      )}
      {s.freq === "hourly" && (
        <div className="flex items-center gap-2 text-sm">
          {t("schedule.form.atMinute")}
          <Input
            type="number"
            min={0}
            max={59}
            aria-label={t("schedule.form.minute")}
            className="w-20"
            value={s.minute}
            onChange={(e) =>
              set({
                ...s,
                minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
              })
            }
          />
        </div>
      )}
      {s.freq === "custom" && (
        <Input
          className="font-mono"
          aria-label={t("schedule.form.cron")}
          value={s.cron}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="text-muted-foreground text-xs">{describe(s, t)}</p>
    </div>
  );
}

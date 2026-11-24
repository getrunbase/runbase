// Readable schedule <-> cron. The engine keeps the cron; the editor only
// shows frequency, days and time. A cron outside these shapes stays
// editable as is ("custom" mode).
import type { WorkflowsT } from "./labels";

export type Schedule =
  | { freq: "hourly"; minute: number }
  | { freq: "daily"; days: number[]; hour: number; minute: number }
  | { freq: "monthly"; day: number; hour: number; minute: number }
  | { freq: "custom"; cron: string };

// Display order Monday -> Sunday; cron value (0 = Sunday).
// Labels: schedule.days.d<value> and schedule.short.d<value>.
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export const DEFAULT_SCHEDULE: Schedule = {
  freq: "daily",
  days: [1, 2, 3, 4, 5],
  hour: 9,
  minute: 0,
};

const int = (s: string, max: number) =>
  /^\d+$/.test(s) && Number(s) <= max ? Number(s) : undefined;

export function toCron(s: Schedule): string {
  if (s.freq === "custom") return s.cron;
  if (s.freq === "hourly") return `${s.minute} * * * *`;
  if (s.freq === "monthly") return `${s.minute} ${s.hour} ${s.day} * *`;
  const days =
    s.days.length && s.days.length < 7 ? [...s.days].sort().join(",") : "*";
  return `${s.minute} ${s.hour} * * ${days}`;
}

export function fromCron(cron: string | undefined): Schedule {
  if (!cron?.trim()) return DEFAULT_SCHEDULE;
  const [m, h, dom, mon, dow, ...rest] = cron.trim().split(/\s+/);
  const minute = int(m ?? "", 59);
  const custom = { freq: "custom" as const, cron };
  if (rest.length || minute === undefined || mon !== "*") return custom;
  if (h === "*" && dom === "*" && dow === "*")
    return { freq: "hourly", minute };
  const hour = int(h ?? "", 23);
  if (hour === undefined) return custom;
  if (dow === "*" && dom !== "*") {
    const day = int(dom ?? "", 31);
    return day ? { freq: "monthly", day, hour, minute } : custom;
  }
  if (dom !== "*") return custom;
  if (dow === "*") return { freq: "daily", days: [], hour, minute };
  const days = dow!.split(",").map((d) => int(d === "7" ? "0" : d, 6));
  return days.every((d) => d !== undefined)
    ? { freq: "daily", days: days as number[], hour, minute }
    : custom;
}

export function describe(s: Schedule, t: WorkflowsT): string {
  const time = (h: number, m: number) =>
    t("schedule.time", { hour: h, minute: String(m).padStart(2, "0") });
  if (s.freq === "custom")
    return t("schedule.describe.custom", { cron: s.cron });
  if (s.freq === "hourly")
    return t("schedule.describe.hourly", { minute: s.minute });
  if (s.freq === "monthly")
    return t("schedule.describe.monthly", {
      day: s.day,
      time: time(s.hour, s.minute),
    });
  const at = time(s.hour, s.minute);
  const names = WEEKDAYS.filter((d) => s.days.includes(d)).map((d) =>
    t(`schedule.days.d${d}`),
  );
  if (!names.length || names.length === 7)
    return t("schedule.describe.everyDay", { time: at });
  if (names.length === 5 && !s.days.includes(0) && !s.days.includes(6))
    return t("schedule.describe.weekdays", { time: at });
  const days = `${names.slice(0, -1).join(", ")}${names.length > 1 ? t("schedule.and") : ""}${names.at(-1)}`;
  return t("schedule.describe.days", { days, time: at });
}

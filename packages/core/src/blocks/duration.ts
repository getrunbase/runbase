// Readable durations (`30s`, `15m`, `2h`, `3d`): wait, delays, backoff.
import { z } from "zod";

const UNITS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as const;

export const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, "Expected duration: 30s, 15m, 2h, 3d");

export const parseDuration = (d: string) =>
  Number(d.slice(0, -1)) * UNITS[d.slice(-1) as keyof typeof UNITS];

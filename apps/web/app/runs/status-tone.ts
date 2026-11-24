import type { Tone } from "@/components/ds/tone";

// Badge colour for a run status (SGuJK, bOUns boards).
export const runTone = (s: string): Tone =>
  s === "succeeded"
    ? "green"
    : s === "failed"
      ? "red"
      : s === "running"
        ? "blue"
        : s === "waiting"
          ? "yellow"
          : s === "canceled"
            ? "neutral"
            : "orange";

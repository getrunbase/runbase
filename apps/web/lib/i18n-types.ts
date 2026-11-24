import type { useTranslations } from "next-intl";

// Typed translator for a namespace, passed to the pure functions of lib/.
export type T<NS extends "common" | "nav" | "home"> = ReturnType<
  typeof useTranslations<NS>
>;

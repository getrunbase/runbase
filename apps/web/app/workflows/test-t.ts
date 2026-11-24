// `workflows` translator for tests (real messages, no React).
import { createTranslator } from "next-intl";
import en from "@/messages/en/workflows.json";
import fr from "@/messages/fr/workflows.json";
import type { WorkflowsT } from "./labels";

export const testT = (locale: "fr" | "en" = "fr") =>
  createTranslator({
    locale,
    messages: { workflows: locale === "fr" ? fr : en },
    namespace: "workflows",
  }) as unknown as WorkflowsT;

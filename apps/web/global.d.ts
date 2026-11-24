import type { Locale } from "@/i18n/config";
import type common from "./messages/en/common.json";
import type auth from "./messages/en/auth.json";
import type nav from "./messages/en/nav.json";
import type home from "./messages/en/home.json";
import type settings from "./messages/en/settings.json";
import type workflows from "./messages/en/workflows.json";
import type objects from "./messages/en/objects.json";
import type databases from "./messages/en/databases.json";
import type pages from "./messages/en/pages.json";
import type interfaces from "./messages/en/interfaces.json";
import type runs from "./messages/en/runs.json";
import type functions from "./messages/en/functions.json";
import type webhooks from "./messages/en/webhooks.json";

// Typed keys: `t("missing.key")` breaks the typecheck. `en` is the reference,
// the messages.test.ts test checks that `fr` has exactly the same keys.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: {
      common: typeof common;
      auth: typeof auth;
      nav: typeof nav;
      home: typeof home;
      settings: typeof settings;
      workflows: typeof workflows;
      objects: typeof objects;
      databases: typeof databases;
      pages: typeof pages;
      interfaces: typeof interfaces;
      runs: typeof runs;
      functions: typeof functions;
      webhooks: typeof webhooks;
    };
  }
}

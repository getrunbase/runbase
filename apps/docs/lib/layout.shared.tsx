import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { LogoMark } from "@/components/logo";
import type { Lang } from "./i18n";
import { homePath } from "./locale-path.mjs";
import { messages } from "./messages";

export function baseOptions(lang: Lang): BaseLayoutProps {
  return {
    i18n: true,
    nav: {
      url: homePath(lang),
      title: (
        <>
          <LogoMark className="size-5" />
          {messages(lang).brand}
        </>
      ),
    },
  };
}

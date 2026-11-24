import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { LogoMark } from "@/components/logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <LogoMark className="size-5" />
          Runbase
        </>
      ),
    },
  };
}

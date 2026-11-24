import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import "./global.css";
import { siteUrl } from "@/lib/site";

export const generateMetadata = (): Metadata => ({
  metadataBase: new URL(siteUrl()),
  title: { template: "%s | Runbase docs", default: "Runbase docs" },
  description:
    "Documentation for Runbase: data, automation and interfaces, built by AI agents through MCP.",
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider search={{ options: { api: "/docs/api/search" } }}>{children}</RootProvider>
      </body>
    </html>
  );
}

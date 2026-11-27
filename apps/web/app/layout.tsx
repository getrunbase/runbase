import type { Metadata } from "next";
import "./globals.css";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { UiLabelsProvider } from "@/components/ui-labels-provider";
import { getLocale, getTranslations } from "next-intl/server";
import { AppSidebar, loadNav } from "@/components/app-sidebar";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HeadScripts } from "@/components/head-scripts";
import { userSession, getSession } from "@/lib/tenant";

// Nothing is indexed: self-hosted app behind sign-in.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.titles");
  return {
    title: { default: t("app"), template: `%s · ${t("app")}` },
    robots: { index: false, follow: false },
  };
}

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

// App layout: sidebar + topbar + ⌘K, nothing outside a session (login…).
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  // Layout queries: session, context (cached), one
  // transaction for navigation.
  const us = session && (await userSession(session.user.id));
  const ctx = us?.ctx;
  const nav = us && (await loadNav(us.ctx, us.role, us.workspaces));
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <HeadScripts />
      </head>
      <body className="min-h-screen">
        <NextIntlClientProvider>
          <UiLabelsProvider>
          <TooltipProvider>
            {ctx && nav ? (
              <AppShell
                names={nav.names}
                sidebar={<AppSidebar ctx={ctx} user={session.user} nav={nav} />}
              >
                {children}
              </AppShell>
            ) : (
              children
            )}
          </TooltipProvider>
          </UiLabelsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

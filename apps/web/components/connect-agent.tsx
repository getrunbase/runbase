"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@getrunbase/ui/components/ui/tabs";
import { CopyField } from "@/components/copy-button";

// Product names, not translated.
const CLIENTS = [
  { id: "claude", name: "Claude" },
  { id: "chatgpt", name: "ChatGPT" },
  { id: "gemini", name: "Gemini" },
  { id: "cursor", name: "Cursor" },
  { id: "codex", name: "Codex" },
  { id: "other", name: null },
] as const;

const code = (c: React.ReactNode) => <code className="font-mono">{c}</code>;

function Step({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

// "Connect your AI": per-client setup for the workspace MCP URL.
export function ConnectAgent({ mcpUrl }: { mcpUrl: string }) {
  const t = useTranslations("common.connectAgent");
  const cursorJson = JSON.stringify({
    mcpServers: { runbase: { url: mcpUrl } },
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t("url")}</p>
        <CopyField value={mcpUrl} />
      </div>
      <Tabs defaultValue="claude">
        <TabsList className="flex-wrap">
          {CLIENTS.map((c) => (
            <TabsTrigger key={c.id} value={c.id}>
              {c.name ?? t("other.tab")}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="claude" className="flex flex-col gap-2 pt-2">
          <Step>{t("claude.code")}</Step>
          <CopyField
            value={`claude mcp add --transport http runbase ${mcpUrl}`}
          />
          <Step>{t.rich("claude.codeLogin", { code })}</Step>
          <Step>{t("claude.desktop")}</Step>
        </TabsContent>
        <TabsContent value="chatgpt" className="flex flex-col gap-2 pt-2">
          <Step>{t("chatgpt.steps")}</Step>
          <Step>{t("chatgpt.note")}</Step>
        </TabsContent>
        <TabsContent value="gemini" className="flex flex-col gap-2 pt-2">
          <Step>{t("gemini.cli")}</Step>
          <CopyField
            value={`gemini mcp add --transport http runbase ${mcpUrl}`}
          />
          <Step>{t.rich("gemini.cliLogin", { code })}</Step>
          <Step>{t("gemini.web")}</Step>
        </TabsContent>
        <TabsContent value="cursor" className="flex flex-col gap-2 pt-2">
          <Step>{t.rich("cursor.steps", { code })}</Step>
          <CopyField value={cursorJson} />
          <Step>{t("cursor.login")}</Step>
        </TabsContent>
        <TabsContent value="codex" className="flex flex-col gap-2 pt-2">
          <Step>{t("codex.steps")}</Step>
          <CopyField value={`codex mcp add runbase --url ${mcpUrl}`} />
          <CopyField value="codex mcp login runbase" />
        </TabsContent>
        <TabsContent value="other" className="flex flex-col gap-2 pt-2">
          <Step>{t("other.oauth")}</Step>
          <Step>{t("other.key")}</Step>
          <CopyField value={`Authorization: Bearer agk_…`} />
          <Step>
            {t.rich("other.keyLink", {
              link: (c) => (
                <Link href="/settings/api-keys" className="text-link underline">
                  {c}
                </Link>
              ),
            })}
          </Step>
        </TabsContent>
      </Tabs>
    </div>
  );
}

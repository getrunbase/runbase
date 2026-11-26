import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { functionsService } from "@getrunbase/core/functions";
import { Sparkles, SquareFunction } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { AgentPrompts } from "@/components/agent-prompts";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@getrunbase/ui/components/ui/table";
import { getTenant } from "@/lib/tenant";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("functions");

// Workspace functions, BTUM8 board.
export default async function Functions() {
  const { ctx } = await getTenant();
  const t = await getTranslations("functions.list");
  const format = await getFormatter();
  const list = await functionsService.list(ctx);
  return (
    <main className="flex flex-1 flex-col gap-6 px-10 py-8">
      <PageHeader title={t("title")} description={t("description")} />
      {list.length === 0 ? (
        <EmptyState
          icon={SquareFunction}
          title={t("empty.title")}
          description={t("empty.description")}
        >
          <AgentPrompts group="functions" />
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-55">{t("columns.name")}</TableHead>
              <TableHead>{t("columns.version")}</TableHead>
              <TableHead className="w-32.5">{t("columns.modified")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child]:border-b">
            {list.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Link
                    href={`/functions/${f.name}`}
                    className="flex items-center gap-2"
                  >
                    <SquareFunction className="text-muted-foreground size-3.5" />
                    <span className="font-mono text-sm font-medium">
                      {f.name}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">v{f.version}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format.relativeTime(f.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="bg-surface-accent flex items-center gap-3 rounded-lg px-4 py-3">
        <Sparkles className="text-link size-4" />
        <p className="flex-1 text-sm">{t("hint")}</p>
      </div>
    </main>
  );
}

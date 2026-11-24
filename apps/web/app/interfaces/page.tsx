import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { pagesService } from "@runbase/core/pages";
import { queryService } from "@runbase/core/query";
import { AppWindow, Database } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageIcon } from "@/components/page-icon";
import { Badge } from "@runbase/ui/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@runbase/ui/components/ui/card";
import { getTenant } from "@/lib/tenant";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("interfaces");

// All interfaces: pages and queries.
export default async function Interfaces() {
  const t = await getTranslations("interfaces.list");
  const { ctx } = await getTenant();
  const [pages, queries] = await Promise.all([
    pagesService.list(ctx),
    queryService.saved(ctx),
  ]);
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Section title={t("pages.title")} count={pages.length}>
        {pages.length === 0 ? (
          <EmptyState
            icon={AppWindow}
            title={t("pages.empty")}
            description={t("pages.emptyDescription")}
          />
        ) : (
          <Grid>
            {pages.map((p) => (
              <Tile
                key={p.id}
                href={`/p/${p.id}`}
                title={p.name}
                icon={
                  <PageIcon name={p.icon ?? "app-window"} className="size-4" />
                }
              />
            ))}
          </Grid>
        )}
      </Section>
      <Section
        title={t("queries.title")}
        count={queries.length}
        hint={t("queries.hint")}
      >
        {queries.length === 0 ? (
          <EmptyState
            icon={Database}
            title={t("queries.empty")}
            description={t("queries.emptyDescription")}
          />
        ) : (
          <Grid>
            {queries.map((q) => (
              <Tile
                key={q.name}
                title={q.name}
                icon={<Database className="size-4" />}
                description={q.sql}
              />
            ))}
          </Grid>
        )}
      </Section>
    </main>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          <Badge variant="secondary">{count}</Badge>
        </h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
);

function Tile({
  href,
  title,
  icon,
  badge,
  description,
}: {
  href?: string;
  title: string;
  icon: React.ReactNode;
  badge?: string;
  description?: string;
}) {
  const card = (
    <Card
      className={href ? "hover:bg-muted/50 h-full transition-colors" : "h-full"}
    >
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="truncate">{title}</span>
            {badge && <Badge variant="outline">{badge}</Badge>}
          </CardTitle>
          {description && (
            <CardDescription className="truncate font-mono text-xs">
              {description}
            </CardDescription>
          )}
        </div>
      </CardHeader>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

import { notFound } from "next/navigation";
import { pagesService } from "@getrunbase/core/pages";
import { getTenant } from "@/lib/tenant";
import { BuilderBar } from "./builder-bar";
import { LivePage } from "./live";
import { pageOr404 } from "./load";
import { showBadge } from "./badge";
import { PoweredBadge } from "./powered-badge";
import { PAGE_HOST } from "./host";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("page");

// Page: multi-file TSX package rendered in the sandbox iframe. The
// builders get the draft / publish / history bar; `?draft=1`
// (or a never-published page) shows the draft. The slug is the id.
export default async function PageView({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx, shot, role } = await getTenant({ shot: true });
  const builder = role === "owner" || role === "admin" || role === "member";
  const { slug } = await params;
  if (shot && shot.page !== slug) notFound();
  const { draft: draftParam } = await searchParams;
  const canDraft = builder || !!shot;
  const published = await pagesService.get(ctx, slug);
  const draft = canDraft && (draftParam === "1" || !published);
  const page = draft
    ? await pageOr404(pagesService.get(ctx, slug, { draft: true }))
    : await pageOr404(Promise.resolve(published));
  const bar = builder && !shot && (
    <BuilderBar
      id={page.id}
      current={page.currentVersion}
      draft={page.hasDraft}
      preview={draft}
    />
  );
  const badge = await showBadge(ctx, { draft, shot: !!shot, builder });
  return (
    // No padding here: the page code owns its spacing, and the frame
    // fills the rest of the screen (no scrollbar when the content fits).
    <div className={PAGE_HOST}>
      {bar && <div className="px-4 pt-4 md:px-6">{bar}</div>}
      <LivePage id={page.id} draft={draft} />
      {badge && <PoweredBadge />}
    </div>
  );
}

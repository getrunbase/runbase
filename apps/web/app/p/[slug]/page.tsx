import { notFound } from "next/navigation";
import { pagesService } from "@runbase/core/pages";
import { getTenant } from "@/lib/tenant";
import { BuilderBar } from "./builder-bar";
import { LivePage } from "./live";
import { pageOr404 } from "./load";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("page");

// Page: multi-file TSX package rendered in the sandbox iframe. The
// builders get the draft / publish / history bar; `?draft=1`
// (or a never-published page) shows the draft. The slug is the id.
// Margins: boards E3GYQo (32/48) and W7AQ2B for end_user (40/96).
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
  return (
    <main
      className={
        role === "end_user"
          ? "flex w-full flex-1 flex-col gap-6 px-24 py-10"
          : "flex w-full flex-1 flex-col gap-6 px-12 py-8"
      }
    >
      {bar}
      <LivePage id={page.id} draft={draft} />
    </main>
  );
}

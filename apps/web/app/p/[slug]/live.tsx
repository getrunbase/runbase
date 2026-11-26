"use client";
// TSX page: only mounts the iframe of the compiled package. Bundle and
// SDK calls go through the page server actions.
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useErrorText } from "@/lib/error-text";
import { pageLive } from "@/lib/live";
import { callPage, pageBundle, reportPageError } from "./actions";
import { CodeFrame, type CodeHost } from "./code-frame";

export function LivePage({ id, draft }: { id: string; draft: boolean }) {
  const router = useRouter();
  const errorText = useErrorText();
  const host = useMemo<CodeHost>(
    () => ({
      screen: true,
      bundle: async () => {
        const r = await pageBundle(id, draft);
        if (!r.data) throw new Error(errorText(r.error));
        return r.data;
      },
      call: async (_, c) => {
        const r = await callPage(id, c, draft);
        // Translated text relayed to the page code (SDK promise rejection).
        if (!r.ok) throw new Error(errorText(r.error));
        return r.result;
      },
      live: pageLive(id, draft),
      report: (_, e) => reportPageError(id, e, draft),
      navigate: (to) =>
        router.push(
          `/p/${to.page}${to.recordId ? `?record=${to.recordId}` : ""}`,
        ),
    }),
    [id, draft, router, errorText],
  );
  return <CodeFrame id={id} props={{}} host={host} />;
}

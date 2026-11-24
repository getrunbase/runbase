/** @jsxRuntime automatic */
// Shared block states: loading (skeleton), error (alert), empty.
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ui/empty";
import { Skeleton } from "@ui/skeleton";

// Default texts (English); the page passes its translations through `labels`.
export const DEFAULT_LABELS = {
  loading: "Loading…",
  error: "Something went wrong",
  empty: "Nothing here yet",
  emptyHint: "",
  search: "Search…",
  yes: "Yes",
  no: "No",
  previous: "Previous",
  next: "Next",
  save: "Save",
  saving: "Saving…",
  none: "—",
  drop: "Drop files here or click to browse",
  uploading: "Uploading…",
  command: "Type a command or search…",
  noResults: "No results",
  clear: "Clear",
  all: "All",
};
export type Labels = Partial<typeof DEFAULT_LABELS>;
export const labelsOf = (l?: Labels) => ({ ...DEFAULT_LABELS, ...l });

export function BlockState({
  loading,
  error,
  empty,
  labels,
  children,
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  labels?: Labels;
  children: ReactNode;
}) {
  const l = labelsOf(labels);
  if (error)
    return (
      <Alert variant="destructive" data-state="error">
        <AlertTitle>{l.error}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (loading)
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={l.loading} data-state="loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  if (empty)
    return (
      <Empty data-state="empty">
        <EmptyHeader>
          <EmptyTitle>{l.empty}</EmptyTitle>
          {l.emptyHint && <EmptyDescription>{l.emptyHint}</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    );
  return <>{children}</>;
}

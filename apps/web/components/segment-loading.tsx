// Local segment loading: skeleton in the content area,
// the sidebar and the header stay visible.
import { Skeleton } from "@/components/ui/skeleton";

export function SegmentLoading({ label }: { label: string }) {
  return (
    <main
      className="flex flex-1 flex-col gap-4 p-4 md:p-6"
      aria-busy
      aria-label={label}
      data-segment-loading
    >
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-72" />
    </main>
  );
}

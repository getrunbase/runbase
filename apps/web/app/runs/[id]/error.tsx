"use client";
// Local segment error: the layout stays visible.
import { useTranslations } from "next-intl";
import { SegmentError } from "@/components/segment-error";

export default function RunError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("runs.boundary");
  return <SegmentError title={t("error")} {...props} />;
}

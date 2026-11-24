"use client";
// Local segment error: the layout stays visible.
import { useTranslations } from "next-intl";
import { SegmentError } from "@/components/segment-error";

export default function ObjectError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("objects.boundary");
  return <SegmentError title={t("error")} {...props} />;
}

// Local segment loading.
import { getTranslations } from "next-intl/server";
import { SegmentLoading } from "@/components/segment-loading";

export default async function RunLoading() {
  const t = await getTranslations("runs.boundary");
  return <SegmentLoading label={t("loading")} />;
}

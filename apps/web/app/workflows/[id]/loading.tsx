// Local segment loading.
import { getTranslations } from "next-intl/server";
import { SegmentLoading } from "@/components/segment-loading";

export default async function WorkflowLoading() {
  const t = await getTranslations("workflows.boundary");
  return <SegmentLoading label={t("loading")} />;
}

// Local segment loading.
import { getTranslations } from "next-intl/server";
import { SegmentLoading } from "@/components/segment-loading";

export default async function ObjectLoading() {
  const t = await getTranslations("objects.boundary");
  return <SegmentLoading label={t("loading")} />;
}

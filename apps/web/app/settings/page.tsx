import { redirect } from "next/navigation";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("settings");

// /settings opens the General tab.
export default function SettingsIndex() {
  redirect("/settings/general");
}

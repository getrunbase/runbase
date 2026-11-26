import { notFound, redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { settingsHome } from "@/lib/settings-access";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("settings");

// /settings opens the first tab the role can see (General, or Usage for
// members); viewers have no settings.
export default async function SettingsIndex() {
  const { role } = await getTenant();
  const home = settingsHome(role);
  if (!home) notFound();
  redirect(home);
}

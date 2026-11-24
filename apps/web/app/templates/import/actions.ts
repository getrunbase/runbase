"use server";

import { revalidatePath } from "next/cache";
import { catalogService } from "@runbase/core/catalog";
import { templatesService } from "@runbase/core/templates";
import { actionError } from "@/lib/action-error";
import { getTenant } from "@/lib/tenant";
import type { ImportTemplateResult } from "../../databases/actions";

// Import of a public catalog template into the current workspace.
export async function importCatalogTemplate(
  _prev: ImportTemplateResult | null,
  form: FormData,
): Promise<ImportTemplateResult> {
  const { ctx } = await getTenant();
  try {
    const t = await catalogService.getTemplate(String(form.get("template")));
    const r = await templatesService.import(ctx, t.manifest);
    revalidatePath("/", "layout");
    return {
      done: {
        name: r.name,
        objects: r.objects,
        missingSecrets: r.missingSecrets,
      },
    };
  } catch (e) {
    return { error: actionError(e) };
  }
}

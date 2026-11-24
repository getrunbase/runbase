"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { databasesService } from "@runbase/core/databases";
import { objectsService, type Field } from "@runbase/core/objects";
import { templatesService } from "@runbase/core/templates";
import { actionError, type ActionError } from "@/lib/action-error";
import { formInput, parseInput } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { slugify } from "../objects/schema";
import { createInput, templateInput } from "./inputs";

// Creates a database with a first object and its fields.
export async function createDatabase(raw: {
  name: string;
  object: string;
  // First fields of the object; none = a "Name" field.
  fields?: Field[];
}): Promise<{ slug?: string; error?: ActionError }> {
  const { ctx } = await getTenant();
  const t = await getTranslations("objects.editor");
  try {
    const input = parseInput(createInput, raw);
    const db = await databasesService.create(ctx, {
      slug: slugify(input.name),
      name: input.name,
    });
    await objectsService.create(ctx, {
      slug: slugify(input.object),
      name: input.object,
      database: db.slug,
      fields: input.fields?.length
        ? input.fields
        : [
            {
              key: "nom",
              label: t("defaultTitle"),
              type: "text",
              title: true,
            },
          ],
    });
    revalidatePath("/", "layout");
    return { slug: db.slug };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export type ImportTemplateResult = {
  error?: ActionError;
  done?: { name: string; objects: number; missingSecrets: string[] };
};

// Import of a runbase-template.json: file text or pasted text.
export async function importTemplate(
  _prev: ImportTemplateResult | null,
  form: FormData,
): Promise<ImportTemplateResult> {
  const { ctx } = await getTenant();
  try {
    const { template } = parseInput(templateInput, formInput(form));
    const r = await templatesService.import(ctx, template);
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

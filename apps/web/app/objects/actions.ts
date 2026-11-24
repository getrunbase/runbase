"use server";

import { revalidatePath } from "next/cache";
import {
  objectsService,
  type Field,
  type MigrateOp,
} from "@runbase/core/objects";
import type { MigrationReport } from "./migrate";
import { z } from "zod";
import { actionError, type ActionError } from "@/lib/action-error";
import { parseInput, trimmed, uuid } from "@/lib/action-input";
import { getTenant } from "@/lib/tenant";
import { slugify } from "./schema";

const saveObjectInput = z.object({
  id: uuid.optional(),
  name: trimmed.min(1).max(200),
  fields: z.array(z.record(z.string(), z.unknown())).max(500),
  database: z.string().max(200).optional(),
});
const migrateInput = z.object({
  id: uuid,
  op: z.record(z.string(), z.unknown()),
  dryRun: z.boolean(),
});

// Schema editor: create an object or update its fields.
export async function saveObject(input: {
  id?: string;
  name: string;
  fields: Field[];
  // Parent database at creation.
  database?: string;
}): Promise<{ slug?: string; error?: ActionError }> {
  const { ctx } = await getTenant();
  try {
    // Field shape: checked in depth by the core (fieldsSchema).
    input = parseInput(saveObjectInput, input) as typeof input;
    const row = input.id
      ? await objectsService.update(ctx, input.id, {
          name: input.name,
          fields: input.fields,
        })
      : await objectsService.create(ctx, {
          slug: slugify(input.name),
          name: input.name,
          fields: input.fields,
          database: input.database,
        });
    revalidatePath("/", "layout");
    return { slug: row?.slug };
  } catch (e) {
    return { error: actionError(e) };
  }
}

// Change to an existing field with its data (key rename,
// type change): preview (dryRun) then apply.
export async function migrateField(
  id: string,
  op: MigrateOp,
  dryRun: boolean,
): Promise<{ report?: MigrationReport; error?: ActionError }> {
  const { ctx } = await getTenant();
  try {
    parseInput(migrateInput, { id, op, dryRun });
    const report = await objectsService.migrate(ctx, id, op, { dryRun });
    if (!dryRun) revalidatePath("/", "layout");
    return { report };
  } catch (e) {
    return { error: actionError(e) };
  }
}

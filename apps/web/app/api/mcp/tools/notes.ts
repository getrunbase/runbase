// MCP tools: workspace notes (persistent agent memory per entity).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import {
  MAX_NOTES_PER_ENTITY,
  NOTE_ENTITY_TYPES,
  notesService,
} from "@getrunbase/core/notes";
import { run } from "./shared";

const entity = z.object({
  type: z.enum(NOTE_ENTITY_TYPES),
  ref: z
    .string()
    .optional()
    .describe(
      "object slug or id, workflow id or name, function name, page id or name; omitted for the workspace",
    ),
});
const noteId = z.string().describe("Note id");

export function defineNoteTools(server: McpServer, ctx: TenantContext) {
  server.registerTool(
    "notes.list",
    {
      description:
        "Lists workspace notes (titles, no body), optionally for one entity. stale: true = the entity changed since the note was written; check it is still right, then notes.save to refresh it.",
      inputSchema: z.object({ entity: entity.optional() }),
    },
    ({ entity }) => run(() => notesService.list(ctx, { entity })),
  );
  server.registerTool(
    "notes.get",
    {
      description: "Reads a note with its body.",
      inputSchema: z.object({ id: noteId }),
    },
    ({ id }) => run(() => notesService.get(ctx, id)),
  );
  server.registerTool(
    "notes.save",
    {
      description: `Saves a note attached to the workspace, an object, a workflow, a function or a page. An existing title on the same entity is updated, not duplicated. Write the why (decisions, local conventions, known pitfalls), not the structure (fields, triggers, steps): workspace.describe already gives it. Max ${MAX_NOTES_PER_ENTITY} notes per entity. Stamps the entity's current version (clears stale).`,
      inputSchema: z.object({
        entity,
        title: z.string().describe("Short title, unique per entity"),
        body: z.string().describe("Markdown body"),
      }),
    },
    (input) => run(() => notesService.save(ctx, input)),
  );
  server.registerTool(
    "notes.delete",
    {
      description: "Deletes a note.",
      inputSchema: z.object({ id: noteId }),
    },
    ({ id }) => run(() => notesService.remove(ctx, id)),
  );
}

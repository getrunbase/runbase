// MCP tools: workspaces, members and quotas.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { TenantContext } from "@getrunbase/core/tenant";
import { workspacesService } from "@getrunbase/core/workspaces";
import { ASSIGNABLE_ROLES, membersService } from "@getrunbase/core/members";
import { quotasService } from "@getrunbase/core/quotas";
import { run } from "./shared";

export function defineAccountTools(server: McpServer, ctx: TenantContext) {
  // Workspaces: ctx targets the organization of the resolved workspace; roles via requireScope.
  server.registerTool(
    "workspaces.create",
    {
      description: "Creates a workspace.",
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    ({ name }) => run(() => workspacesService.create(ctx, name)),
  );
  server.registerTool(
    "workspaces.rename",
    {
      description: "Renames a workspace.",
      inputSchema: z.object({ id: z.string(), name: z.string().min(1) }),
    },
    ({ id, name }) => run(() => workspacesService.rename(ctx, id, name)),
  );
  server.registerTool(
    "workspaces.delete",
    {
      description: "Deletes a workspace (the last one cannot be deleted).",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => workspacesService.remove(ctx, id)),
  );

  // Members
  server.registerTool(
    "members.invite",
    {
      description:
        "Invites a person to the organization by email (admin scope). The invitation stays pending, with no access at all, until the invitee accepts it (email sent with the link). Roles: admin (manage everything), member (create and edit), viewer (read-only), end_user (only opens pages, no MCP). Default: member. Access is limited to workspaceIds (default: the current workspace; null = all workspaces, including future ones). Owners and admins always access every workspace. Inviting someone already invited or already a member adds the workspaces to their access (a pending invitation also takes the new role and is resent).",
      inputSchema: z.object({
        email: z.string().email(),
        role: z.enum(ASSIGNABLE_ROLES).optional(),
        workspaceIds: z
          .array(z.string())
          .min(1)
          .nullable()
          .optional()
          .describe(
            "Workspace ids from workspaces.list; null = all workspaces; omitted = the current workspace",
          ),
      }),
    },
    ({ workspaceIds, ...input }) =>
      run(() =>
        membersService.invite(ctx, {
          ...input,
          workspaceIds:
            workspaceIds === undefined ? [ctx.workspaceId] : workspaceIds,
        }),
      ),
  );
  server.registerTool(
    "members.list",
    {
      description:
        "Lists organization members and pending invitations (pending: true): id, name, email, role, workspaceIds (accessible workspaces; null = all).",
    },
    () => run(() => membersService.list(ctx)),
  );
  server.registerTool(
    "members.set_role",
    {
      description:
        "Changes a member's role (id from members.list, admin scope). The owner's role does not change.",
      inputSchema: z.object({
        id: z.string(),
        role: z.enum(ASSIGNABLE_ROLES),
      }),
    },
    ({ id, role }) => run(() => membersService.setRole(ctx, id, role)),
  );
  server.registerTool(
    "members.set_workspaces",
    {
      description:
        "Sets the workspaces a member or pending invitee can access (id from members.list, admin scope). workspaceIds replaces the current list; null = all workspaces. Owners and admins always access every workspace (null only).",
      inputSchema: z.object({
        id: z.string(),
        workspaceIds: z
          .array(z.string())
          .min(1)
          .nullable()
          .describe("Workspace ids from workspaces.list, or null for all"),
      }),
    },
    ({ id, workspaceIds }) =>
      run(() => membersService.setWorkspaces(ctx, id, workspaceIds)),
  );
  server.registerTool(
    "members.remove",
    {
      description:
        "Removes a member from the organization or cancels an invitation (admin scope). The owner cannot be removed.",
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => membersService.remove(ctx, id)),
  );

  // Workspace quotas
  server.registerTool(
    "quotas.get",
    {
      description:
        "Workspace limits and usage: records (maximum count), runsPerMinute (workflow runs per minute), apiPerMinute (MCP and ingestion calls per minute), concurrency (workflow steps and trigger events processed at the same time; extra jobs wait their turn). Beyond the first three, calls fail with a quota_exceeded error (HTTP 429).",
    },
    () => run(() => quotasService.get(ctx)),
  );
  server.registerTool(
    "quotas.set",
    {
      description:
        "Sets the workspace limits (admin scope). An omitted value reverts to the default. Values are capped by the account limits (quotas.get: caps, null = unlimited): a value above them is refused (quotas.exceedsLimit).",
      inputSchema: z.object({
        records: z.number().int().positive().optional(),
        runsPerMinute: z.number().int().positive().optional(),
        apiPerMinute: z.number().int().positive().optional(),
        concurrency: z.number().int().positive().optional(),
      }),
    },
    (input) => run(() => quotasService.set(ctx, input)),
  );
}

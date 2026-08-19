import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { getWidget, upsertWidgetAgent } from "@/modules/widgets/service";

const bodySchema = z.object({
  agentId: z.string().min(1),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  routingRole: z.string().nullable().optional(),
  routingDescription: z.string().nullable().optional(),
  allowedIntents: z.array(z.string()).optional(),
});

// Adds or updates one agent's eligibility/routing config on a widget
// (multi-agent-routing spec Part A §3: WidgetAgent). Never duplicates
// Agent configuration — only references an existing agentId.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "edit")) return jsonError("Forbidden", 403);

  const widget = await getWidget(session.tenantId, params.id);
  if (!widget) return jsonError("Widget not found", 404);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  await upsertWidgetAgent({ widgetId: widget.id, ...parsed.data });
  return jsonOk({ ok: true });
}

import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { getWidget, removeWidgetAgent } from "@/modules/widgets/service";

export async function DELETE(_req: Request, { params }: { params: { id: string; agentId: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "edit")) return jsonError("Forbidden", 403);

  const widget = await getWidget(session.tenantId, params.id);
  if (!widget) return jsonError("Widget not found", 404);

  await removeWidgetAgent(widget.id, params.agentId);
  return jsonOk({ ok: true });
}

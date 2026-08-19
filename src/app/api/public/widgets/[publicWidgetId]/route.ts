import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { jsonError, jsonOk } from "@/lib/api";

// Public, unauthenticated endpoint the NEW <script data-widget="...">
// embed calls on load (multi-agent-routing spec Part A §5) — the
// data-widget counterpart to /api/public/agents/[publicAgentId], which
// legacy data-agent embeds keep using unchanged. Only widget-safe display
// fields, same restriction as the legacy route (spec §1: no secret
// credentials in browser code).
export async function GET(_req: Request, { params }: { params: { publicWidgetId: string } }) {
  const [widget] = await db.select().from(schema.widgets).where(and(eq(schema.widgets.publicWidgetId, params.publicWidgetId), eq(schema.widgets.status, "ACTIVE"))).limit(1);
  if (!widget) return jsonError("Widget not found", 404);

  // Widget-level branding falls back to the default agent's, so a widget
  // created without its own logo/colour/greeting still looks right —
  // most tenants will never bother overriding these per-widget.
  const [agent] = widget.defaultAgentId ? await db.select().from(schema.agents).where(eq(schema.agents.id, widget.defaultAgentId)).limit(1) : [null];

  return jsonOk({
    publicWidgetId: widget.publicWidgetId,
    name: agent?.name ?? widget.name,
    avatarUrl: agent?.avatarUrl ?? null,
    company: agent?.company ?? null,
    greeting: widget.greeting ?? agent?.greeting ?? "Hi! How can I help you today?",
    widgetColor: widget.brandColour ?? agent?.widgetColor ?? "#4F46E5",
    launcherPosition: widget.launcherPosition ?? agent?.launcherPosition ?? "bottom-right",
  });
}

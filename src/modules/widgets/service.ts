import { db, schema } from "@/db/client";
import { generateId, generatePublicWidgetId } from "@/lib/ids";
import { and, desc, eq } from "drizzle-orm";

// ============================================================================
// Widget CRUD + the lazy legacy-widget backfill (multi-agent-routing spec
// Part A §4: "Existing widget configuration must migrate safely... Run
// migration safely and idempotently"). Deliberately lazy/get-or-create
// rather than a one-off batch migration script: the very first time a
// legacy `<script data-agent="...">` embed is resolved after this shipped
// (or the very first time an agent is created), it gets a matching
// SINGLE_AGENT Widget row created for it — idempotent by construction (a
// re-check before insert), no ops step required, and it self-heals for
// agents created before this file existed AND ones created after.
// ============================================================================

/** Finds-or-creates the implicit SINGLE_AGENT widget behind an existing
 * agent's `data-agent` embed. Never creates a second one for the same
 * agent — safe to call on every legacy conversation-start. */
export async function ensureLegacyWidgetForAgent(tenantId: string, agentId: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.widgets.id })
    .from(schema.widgets)
    .where(and(eq(schema.widgets.tenantId, tenantId), eq(schema.widgets.defaultAgentId, agentId), eq(schema.widgets.routingMode, "SINGLE_AGENT")))
    .limit(1);
  if (existing) return existing.id;

  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  const widgetId = generateId();
  await db.insert(schema.widgets).values({
    id: widgetId,
    tenantId,
    publicWidgetId: generatePublicWidgetId(),
    name: agent ? `${agent.name} Widget` : "Website Widget",
    defaultAgentId: agentId,
    routingMode: "SINGLE_AGENT",
    status: "ACTIVE",
  });
  await db.insert(schema.widgetAgents).values({ id: generateId(), widgetId, agentId, enabled: true, priority: 0 });
  return widgetId;
}

export async function firstEnabledWidgetAgent(widgetId: string): Promise<string | null> {
  const [link] = await db
    .select({ agentId: schema.widgetAgents.agentId })
    .from(schema.widgetAgents)
    .where(and(eq(schema.widgetAgents.widgetId, widgetId), eq(schema.widgetAgents.enabled, true)))
    .orderBy(desc(schema.widgetAgents.priority))
    .limit(1);
  return link?.agentId ?? null;
}

export async function listWidgets(tenantId: string) {
  return db.select().from(schema.widgets).where(eq(schema.widgets.tenantId, tenantId)).orderBy(desc(schema.widgets.createdAt));
}

export async function getWidget(tenantId: string, widgetId: string) {
  const [widget] = await db.select().from(schema.widgets).where(and(eq(schema.widgets.id, widgetId), eq(schema.widgets.tenantId, tenantId))).limit(1);
  return widget ?? null;
}

export async function listWidgetAgents(widgetId: string) {
  return db.select().from(schema.widgetAgents).where(eq(schema.widgetAgents.widgetId, widgetId)).orderBy(desc(schema.widgetAgents.priority));
}

export async function createWidget(params: { tenantId: string; name: string; defaultAgentId: string }) {
  const widgetId = generateId();
  await db.insert(schema.widgets).values({
    id: widgetId,
    tenantId: params.tenantId,
    publicWidgetId: generatePublicWidgetId(),
    name: params.name,
    defaultAgentId: params.defaultAgentId,
    routingMode: "SINGLE_AGENT",
    status: "ACTIVE",
  });
  await db.insert(schema.widgetAgents).values({ id: generateId(), widgetId, agentId: params.defaultAgentId, enabled: true, priority: 0 });
  return getWidget(params.tenantId, widgetId);
}

export async function updateWidget(
  tenantId: string,
  widgetId: string,
  patch: Partial<{ name: string; routingMode: (typeof schema.WIDGET_ROUTING_MODES)[number]; defaultAgentId: string | null; fallbackAgentId: string | null; status: (typeof schema.WIDGET_STATUSES)[number] }>
) {
  await db
    .update(schema.widgets)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.widgets.id, widgetId), eq(schema.widgets.tenantId, tenantId)));
  return getWidget(tenantId, widgetId);
}

export async function upsertWidgetAgent(params: {
  widgetId: string;
  agentId: string;
  enabled?: boolean;
  priority?: number;
  routingRole?: string | null;
  routingDescription?: string | null;
  allowedIntents?: string[];
}) {
  const [existing] = await db
    .select({ id: schema.widgetAgents.id })
    .from(schema.widgetAgents)
    .where(and(eq(schema.widgetAgents.widgetId, params.widgetId), eq(schema.widgetAgents.agentId, params.agentId)))
    .limit(1);
  if (existing) {
    await db
      .update(schema.widgetAgents)
      .set({
        enabled: params.enabled ?? true,
        priority: params.priority ?? 0,
        routingRole: params.routingRole ?? null,
        routingDescription: params.routingDescription ?? null,
        allowedIntents: params.allowedIntents ?? [],
        updatedAt: new Date(),
      })
      .where(eq(schema.widgetAgents.id, existing.id));
    return existing.id;
  }
  const id = generateId();
  await db.insert(schema.widgetAgents).values({
    id,
    widgetId: params.widgetId,
    agentId: params.agentId,
    enabled: params.enabled ?? true,
    priority: params.priority ?? 0,
    routingRole: params.routingRole ?? null,
    routingDescription: params.routingDescription ?? null,
    allowedIntents: params.allowedIntents ?? [],
  });
  return id;
}

export async function removeWidgetAgent(widgetId: string, agentId: string) {
  await db.delete(schema.widgetAgents).where(and(eq(schema.widgetAgents.widgetId, widgetId), eq(schema.widgetAgents.agentId, agentId)));
}

import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { generateId } from "@/lib/ids";
import { jsonError, jsonOk } from "@/lib/api";
import { getOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md section 7 / section 35 — "Widget installed"
// must mean verification succeeded, never a hardcoded checkmark. This
// fetches the business's own website (collected in the Business Profile
// step) server-side and checks the actual returned HTML for the widget
// script tag referencing this tenant's specific agent — a genuinely
// real check that fails if the snippet isn't actually there. (Known,
// honest limitation: this only sees server-rendered HTML, so a snippet
// injected client-side via a JS-only SPA/tag-manager won't be found this
// way — that's a real gap, not a fake pass, and is why "skip" below stays
// available rather than forcing a false negative into a dead end.)
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await getOnboardingProgress(session.tenantId);
  if (!progress?.agentId) return jsonError("No agent set up yet", 409);

  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, progress.agentId)).limit(1);
  if (!agent) return jsonError("Agent not found", 404);

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId)).limit(1);
  if (!tenant?.websiteUrl) {
    return jsonOk({ verified: false, reason: "NO_WEBSITE_URL" });
  }

  let html = "";
  try {
    const res = await fetch(tenant.websiteUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return jsonOk({ verified: false, reason: "SITE_UNREACHABLE" });
    html = await res.text();
  } catch {
    return jsonOk({ verified: false, reason: "SITE_UNREACHABLE" });
  }

  const verified = html.includes("/widget.js") && html.includes(agent.publicAgentId);
  if (!verified) return jsonOk({ verified: false, reason: "SNIPPET_NOT_FOUND" });

  await db
    .update(schema.channelConnections)
    .set({ status: "CONNECTED", connectedAt: new Date() })
    .where(and(eq(schema.channelConnections.tenantId, session.tenantId), eq(schema.channelConnections.channel, "WEBSITE")));
  // channel_connections rows are created lazily — insert if this tenant
  // never had one (e.g. pre-existing tenants from before this milestone).
  const [existing] = await db
    .select({ id: schema.channelConnections.id })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.tenantId, session.tenantId), eq(schema.channelConnections.channel, "WEBSITE")))
    .limit(1);
  if (!existing) {
    await db.insert(schema.channelConnections).values({
      id: generateId(),
      tenantId: session.tenantId,
      channel: "WEBSITE",
      status: "CONNECTED",
      connectedAt: new Date(),
    });
  }

  const nextProgress = await advanceOnboardingStep(session.tenantId, "CHANNEL_CONNECT", "HEALTH_CHECK");
  await logOnboardingEvent(session.tenantId, "channel_connected", { channel: "website" });

  return jsonOk({ verified: true, progress: nextProgress });
}

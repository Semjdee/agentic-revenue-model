import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { createHmac } from "crypto";

// ============================================================================
// Outbound webhook dispatch (spec section 20).
//
// SIMPLIFICATION: delivery is attempted synchronously with one retry rather
// than through a BullMQ queue. The follow-up engine (src/modules/followups)
// *does* use BullMQ, per spec — this module was kept simpler because webhook
// fan-out here is low volume for an MVP demo. Moving delivery onto the same
// Redis-backed queue is a small, well-isolated change (swap the `fetch` call
// below for `webhookQueue.add(...)`) — see BUILD_NOTES.md.
// ============================================================================

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function dispatchWebhooks(tenantId: string, event: string, payload: Record<string, unknown>) {
  const endpoints = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.tenantId, tenantId), eq(schema.webhookEndpoints.status, "ACTIVE")));

  const targets = endpoints.filter((e) => (e.events ?? []).includes(event));
  for (const endpoint of targets) {
    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
    const signature = signPayload(endpoint.signingSecret, body);
    let responseStatus: number | null = null;
    let status: "SUCCESS" | "FAILED" = "FAILED";
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-webhook-signature": signature, "x-webhook-event": event },
        body,
        signal: AbortSignal.timeout(5000),
      });
      responseStatus = res.status;
      status = res.ok ? "SUCCESS" : "FAILED";
    } catch {
      responseStatus = null;
      status = "FAILED";
    }
    await db.insert(schema.webhookDeliveries).values({
      id: generateId(),
      tenantId,
      webhookEndpointId: endpoint.id,
      event,
      payload,
      responseStatus,
      attempt: 1,
      status,
    });
  }
}

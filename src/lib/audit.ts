import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";

// Central audit logging (section 24). Never pass passwords, access tokens,
// or API secrets into `before`/`after` — callers are responsible for
// redacting sensitive fields before calling this.
export async function logAudit(params: {
  tenantId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  source?: "APP" | "API" | "WEBHOOK" | "SYSTEM";
}) {
  await db.insert(schema.auditLogs).values({
    id: generateId(),
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    ip: params.ip ?? null,
    source: params.source ?? "APP",
  });
}

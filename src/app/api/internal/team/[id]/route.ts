import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { ROLES } from "@/db/schema";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "team", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  await db.update(schema.users).set(parsed.data).where(and(eq(schema.users.id, params.id), eq(schema.users.tenantId, session.tenantId)));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "user.permission_changed", entity: "user", entityId: params.id, after: parsed.data });
  return jsonOk({ ok: true });
}

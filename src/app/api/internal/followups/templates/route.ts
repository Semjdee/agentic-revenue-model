import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { generateId } from "@/lib/ids";
import { ensureDefaultFollowUpSequence, AVAILABLE_TEMPLATE_VARIABLES } from "@/modules/followups/templates";

const createSchema = z.object({
  name: z.string().min(1),
  messageBody: z.string().min(1),
});

// Backs Settings → Follow-up Templates. Ensures the tenant's default
// sequence (and its 2 starter templates) exist before listing, so a
// tenant opening this for the first time sees real, editable starting
// content instead of an empty state with nothing to build from.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  await ensureDefaultFollowUpSequence(session.tenantId);
  const templates = await db.select().from(schema.followUpTemplates).where(eq(schema.followUpTemplates.tenantId, session.tenantId)).orderBy(desc(schema.followUpTemplates.createdAt));

  return jsonOk({ templates, availableVariables: AVAILABLE_TEMPLATE_VARIABLES });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "followups", "create")) return jsonError("Forbidden", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.followUpTemplates).values({ id, tenantId: session.tenantId, name: parsed.data.name, messageBody: parsed.data.messageBody });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "followup_template.created", entity: "follow_up_template", entityId: id, after: { name: parsed.data.name } });

  return jsonOk({ id }, 201);
}

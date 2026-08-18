import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession, hashPassword } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { ROLES } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { randomBytes } from "crypto";

const bodySchema = z.object({ name: z.string().min(1), email: z.string().email(), role: z.enum(ROLES) });

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.tenantId, session.tenantId));
  return jsonOk(rows);
}

// Invites a teammate. No email delivery in this sandbox — generates a
// temporary password and returns it once (a real deployment would email an
// invite link instead).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "team", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email)).limit(1);
  if (existing) return jsonError("A user with this email already exists", 409);

  const tempPassword = randomBytes(6).toString("hex");
  const id = generateId();
  await db.insert(schema.users).values({
    id,
    tenantId: session.tenantId,
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    passwordHash: await hashPassword(tempPassword),
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "user.invited", entity: "user", entityId: id, after: { role: parsed.data.role } });

  return jsonOk({ id, temporaryPassword: tempPassword }, 201);
}

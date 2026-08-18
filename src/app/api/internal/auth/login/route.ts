import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { email, password } = parsed.data;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Deliberately generic error message — never reveal whether the email
  // exists (avoid user enumeration).
  if (!user || !user.active) return jsonError("Invalid email or password", 401);

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return jsonError("Invalid email or password", 401);

  await setSessionCookie({ userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name });
  await logAudit({ tenantId: user.tenantId, userId: user.id, action: "user.login", entity: "user", entityId: user.id, source: "APP" });

  return jsonOk({ userId: user.id, role: user.role, name: user.name });
}

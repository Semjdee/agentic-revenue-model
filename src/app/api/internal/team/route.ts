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
import { checkSeatAvailability } from "@/modules/team/seats";
import { ADDITIONAL_SEAT_PRICE_USD } from "@/modules/billing/plans";

const bodySchema = z.object({ name: z.string().min(1), email: z.string().email(), role: z.enum(ROLES) });

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const [rows, seats] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, active: schema.users.active, status: schema.users.status, createdAt: schema.users.createdAt })
      .from(schema.users)
      .where(eq(schema.users.tenantId, session.tenantId)),
    checkSeatAvailability(session.tenantId),
  ]);
  return jsonOk({ members: rows, seats });
}

// Invites a teammate. No email delivery in this sandbox — generates a
// temporary password and returns it once (a real deployment would email an
// invite link instead). New user starts in "INVITED" status (Industry Team
// Subscription Architecture doc, Part B) and flips to "ACTIVE" on their
// first successful login (see api/internal/auth/login/route.ts) — both
// count toward the tenant's billable seats.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "team", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email)).limit(1);
  if (existing) return jsonError("A user with this email already exists", 409);

  const seats = await checkSeatAvailability(session.tenantId);
  if (seats.atOrOverIncluded && seats.plan === "FREE") {
    return jsonError(
      `Your Free plan includes ${seats.included} seats and you're using all of them. Upgrade to Pro or Premium to invite more teammates.`,
      402,
      "SEAT_LIMIT_REACHED"
    );
  }

  const tempPassword = randomBytes(6).toString("hex");
  const id = generateId();
  await db.insert(schema.users).values({
    id,
    tenantId: session.tenantId,
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    passwordHash: await hashPassword(tempPassword),
    status: "INVITED",
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "user.invited", entity: "user", entityId: id, after: { role: parsed.data.role } });

  // Over the plan's included seat count (allowed on PRO/PREMIUM) — flagged
  // so the UI can tell the owner this teammate adds $5/mo once they
  // purchase a subscription term reflecting the new seat count (Part C).
  const overIncludedSeats = seats.atOrOverIncluded && seats.plan !== "FREE";
  return jsonOk({ id, temporaryPassword: tempPassword, overIncludedSeats, additionalSeatPriceUsd: ADDITIONAL_SEAT_PRICE_USD }, 201);
}

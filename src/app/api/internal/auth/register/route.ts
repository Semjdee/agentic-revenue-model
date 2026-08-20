import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { eq } from "drizzle-orm";
import { checkPasswordStrength } from "@/lib/password-strength";
import { provisionTenant } from "@/modules/auth/provision";

const bodySchema = z.object({
  companyName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// Bootstraps a brand-new Tenant + Workspace + OWNER user. In a real product
// this would be gated behind a signup/billing flow; kept simple for the MVP
// so a fresh install can be created without manual DB seeding.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { companyName, name, email, password } = parsed.data;

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return jsonError("An account with this email already exists", 409);

  // Audit finding F-4: length alone lets through plenty of realistically
  // guessable passwords. zxcvbn-style scoring also checks the password
  // isn't just a trivial variant of the email/name/company being signed
  // up with (see src/lib/password-strength.ts).
  const strength = checkPasswordStrength(password, [email, name, companyName]);
  if (!strength.ok) {
    return jsonError(strength.warning || "This password is too easy to guess — please choose a stronger one.", 422, "WEAK_PASSWORD");
  }

  const passwordHash = await hashPassword(password);
  const { tenantId, userId } = await provisionTenant({ companyName, ownerName: name, email, passwordHash });

  await setSessionCookie({ userId, tenantId, role: "OWNER", email, name });
  return jsonOk({ tenantId, userId });
}

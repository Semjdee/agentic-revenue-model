import "dotenv/config";
import { db, schema } from "../src/db/client";
import { eq } from "drizzle-orm";
import { generateId } from "../src/lib/ids";
import { hashPassword } from "../src/lib/auth";

// Deliberately the ONLY way to create a platform_staff row — there is no
// API route or UI form for it (see db/schema.ts's header comment on
// platform_staff: letting anyone self-register cross-tenant admin access
// would defeat the entire point of separating it from tenant auth).
// Run with: npx tsx scripts/create-platform-staff.ts <email> <name> <password> [role]
async function main() {
  const [email, name, password, role = "PLATFORM_SUPER_ADMIN"] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error("Usage: npx tsx scripts/create-platform-staff.ts <email> <name> <password> [role]");
    console.error(`Roles: ${schema.PLATFORM_ROLES.join(", ")}`);
    process.exit(1);
  }
  if (!(schema.PLATFORM_ROLES as readonly string[]).includes(role)) {
    console.error(`Unknown role "${role}". Valid roles: ${schema.PLATFORM_ROLES.join(", ")}`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const [existing] = await db.select().from(schema.platformStaff).where(eq(schema.platformStaff.email, email)).limit(1);
  if (existing) {
    console.error(`A platform staff account already exists for ${email} (id: ${existing.id}).`);
    process.exit(1);
  }

  const id = generateId();
  const passwordHash = await hashPassword(password);
  await db.insert(schema.platformStaff).values({ id, email, name, passwordHash, role: role as (typeof schema.PLATFORM_ROLES)[number], active: true });

  console.log(`Created platform staff account:`);
  console.log(`  id:    ${id}`);
  console.log(`  email: ${email}`);
  console.log(`  role:  ${role}`);
  console.log(`Sign in at /platform/login`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  features: z.array(z.string()).default([]),
  sellingPoints: z.array(z.string()).default([]),
  price: z.string().optional(),
  currency: z.string().default("UGX"),
  availability: z.string().default("IN_STOCK"),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.products).where(eq(schema.products.tenantId, session.tenantId)).orderBy(desc(schema.products.createdAt));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "settings", "edit") && session.role !== "MARKETING") {
    // products fall under general management; allow OWNER/ADMIN/MANAGER/MARKETING
    if (!["OWNER", "ADMIN", "MANAGER", "MARKETING"].includes(session.role)) return jsonError("Forbidden", 403);
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.products).values({ id, tenantId: session.tenantId, ...parsed.data });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "product.created", entity: "product", entityId: id, after: parsed.data });
  return jsonOk({ id }, 201);
}

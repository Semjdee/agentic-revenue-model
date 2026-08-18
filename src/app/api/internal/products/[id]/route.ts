import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

const patchSchema = z.object({
  name: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  sellingPoints: z.array(z.string()).optional(),
  price: z.string().optional(),
  availability: z.string().optional(),
  status: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  await db.update(schema.products).set(parsed.data).where(and(eq(schema.products.id, params.id), eq(schema.products.tenantId, session.tenantId)));
  return jsonOk({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  await db.update(schema.products).set({ status: "ARCHIVED" }).where(and(eq(schema.products.id, params.id), eq(schema.products.tenantId, session.tenantId)));
  return jsonOk({ ok: true });
}

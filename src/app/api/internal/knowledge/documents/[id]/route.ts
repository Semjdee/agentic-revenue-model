import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { reindexDocument } from "@/modules/knowledge/service";

const patchSchema = z.object({ title: z.string().optional(), content: z.string().optional() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title) patch.title = parsed.data.title;
  if (parsed.data.content) patch.content = parsed.data.content;

  await db.update(schema.knowledgeDocuments).set(patch).where(and(eq(schema.knowledgeDocuments.id, params.id), eq(schema.knowledgeDocuments.tenantId, session.tenantId)));
  if (parsed.data.content) await reindexDocument(params.id, session.tenantId, parsed.data.content);

  return jsonOk({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  await db.delete(schema.knowledgeDocuments).where(and(eq(schema.knowledgeDocuments.id, params.id), eq(schema.knowledgeDocuments.tenantId, session.tenantId)));
  return jsonOk({ ok: true });
}

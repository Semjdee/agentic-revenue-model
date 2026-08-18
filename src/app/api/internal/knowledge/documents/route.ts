import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { indexDocument } from "@/modules/knowledge/service";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  collectionId: z.string(),
  title: z.string().min(1),
  content: z.string().min(1),
  sourceType: z.enum(["MANUAL", "URL", "PDF", "FAQ"]).default("MANUAL"),
  sourceUrl: z.string().optional(),
});

// Backs the "Add Knowledge" dialog box: a business owner pastes/types
// information (FAQ, policy, product info, company info, ...) here and it is
// immediately chunked + indexed for the AI Sales Agent to retrieve from
// (spec section 17).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const collectionId = req.nextUrl.searchParams.get("collectionId");
  const rows = await db
    .select()
    .from(schema.knowledgeDocuments)
    .where(eq(schema.knowledgeDocuments.tenantId, session.tenantId))
    .orderBy(desc(schema.knowledgeDocuments.createdAt));
  return jsonOk(collectionId ? rows.filter((r) => r.collectionId === collectionId) : rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "knowledge", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const documentId = await indexDocument({
    tenantId: session.tenantId,
    collectionId: parsed.data.collectionId,
    title: parsed.data.title,
    content: parsed.data.content,
    sourceType: parsed.data.sourceType,
    sourceUrl: parsed.data.sourceUrl,
  });

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "knowledge.document.created",
    entity: "knowledge_document",
    entityId: documentId,
    after: { title: parsed.data.title, sourceType: parsed.data.sourceType },
  });

  return jsonOk({ id: documentId }, 201);
}

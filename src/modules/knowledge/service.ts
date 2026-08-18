import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";

// ============================================================================
// Knowledge Base service — powers the "Add Knowledge" dialog box.
//
// Design for RAG (spec section 17: "The AI should retrieve relevant
// knowledge rather than blindly injecting the entire knowledge base into
// each prompt"). We chunk documents and score chunks against the customer's
// message using lexical (keyword) overlap.
//
// NOTE: the spec's recommended stack (section 25) says "use pgvector unless
// there's a strong technical reason to add another vector service." This
// sandbox cannot install Postgres extensions it doesn't already ship with,
// and we could not verify `pgvector` is available, so retrieval here uses a
// keyword/TF overlap scorer instead of embeddings. The schema keeps a
// `keywords` column per chunk specifically so this can be swapped for a
// `vector` column + cosine-similarity query later without changing any
// calling code — see BUILD_NOTES.md.
// ============================================================================

const STOPWORDS = new Set(
  "a an the is are was were be been being to of in on for with and or but if then so as at by from this that these those it its i you he she they we our your their can will would should could do does did not no yes what how when where why which who".split(
    " "
  )
);

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

export function chunkText(text: string, maxLen = 700): string[] {
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs.length ? paragraphs : [text]) {
    if ((current + "\n\n" + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

export async function indexDocument(params: {
  tenantId: string;
  collectionId: string;
  title: string;
  content: string;
  sourceType?: "MANUAL" | "URL" | "PDF" | "FAQ";
  sourceUrl?: string;
}) {
  const documentId = generateId();
  await db.insert(schema.knowledgeDocuments).values({
    id: documentId,
    tenantId: params.tenantId,
    collectionId: params.collectionId,
    title: params.title,
    content: params.content,
    sourceType: params.sourceType ?? "MANUAL",
    sourceUrl: params.sourceUrl,
    status: "READY",
  });

  const chunks = chunkText(params.content);
  if (chunks.length) {
    await db.insert(schema.knowledgeChunks).values(
      chunks.map((content, position) => ({
        id: generateId(),
        tenantId: params.tenantId,
        documentId,
        content,
        position,
        keywords: extractKeywords(content),
      }))
    );
  }
  return documentId;
}

export async function reindexDocument(documentId: string, tenantId: string, content: string) {
  await db
    .delete(schema.knowledgeChunks)
    .where(and(eq(schema.knowledgeChunks.documentId, documentId), eq(schema.knowledgeChunks.tenantId, tenantId)));
  const chunks = chunkText(content);
  if (chunks.length) {
    await db.insert(schema.knowledgeChunks).values(
      chunks.map((c, position) => ({
        id: generateId(),
        tenantId,
        documentId,
        content: c,
        position,
        keywords: extractKeywords(c),
      }))
    );
  }
}

export interface RetrievedChunk {
  documentTitle: string;
  content: string;
  score: number;
}

/** Lexical retrieval: score chunks by keyword overlap with the query. */
export async function retrieveRelevantKnowledge(
  tenantId: string,
  query: string,
  limit = 4
): Promise<RetrievedChunk[]> {
  const queryKeywords = new Set(extractKeywords(query));
  if (queryKeywords.size === 0) return [];

  const rows = await db
    .select({
      content: schema.knowledgeChunks.content,
      keywords: schema.knowledgeChunks.keywords,
      title: schema.knowledgeDocuments.title,
    })
    .from(schema.knowledgeChunks)
    .innerJoin(schema.knowledgeDocuments, eq(schema.knowledgeChunks.documentId, schema.knowledgeDocuments.id))
    .where(eq(schema.knowledgeChunks.tenantId, tenantId));

  const scored = rows
    .map((r) => {
      const chunkKeywords = new Set(r.keywords ?? []);
      let overlap = 0;
      for (const kw of queryKeywords) if (chunkKeywords.has(kw)) overlap += 1;
      return { documentTitle: r.title, content: r.content, score: overlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

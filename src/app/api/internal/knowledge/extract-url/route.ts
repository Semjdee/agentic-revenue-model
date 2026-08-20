import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { extractFromUrl, ExtractionError } from "@/modules/knowledge/extract";

const bodySchema = z.object({ url: z.string().min(1) });

// Backs the "Add Knowledge" dialog's URL mode "Fetch page content" action.
// Returns the extracted title/text for the owner to review and edit —
// this never writes to the Knowledge Base itself, the existing
// POST /api/internal/knowledge/documents call still does that once the
// owner hits Save (spec: the owner always confirms what the AI can say).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "knowledge", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  try {
    const result = await extractFromUrl(parsed.data.url);
    return jsonOk(result);
  } catch (err) {
    if (err instanceof ExtractionError) return jsonError(err.message, 422, "EXTRACTION_FAILED");
    // eslint-disable-next-line no-console
    console.error("[knowledge] URL extraction failed unexpectedly:", err);
    return jsonError("Couldn't fetch that page.", 500);
  }
}

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { extractFromPdf, ExtractionError } from "@/modules/knowledge/extract";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — generous for a policy/catalogue PDF, small enough for a serverless function body

// Backs the "Add Knowledge" dialog's PDF mode. Accepts a multipart file
// upload, extracts its text server-side, and hands it back for the owner
// to review/edit before saving — same non-destructive pattern as
// extract-url/route.ts. Nothing here writes to the Knowledge Base.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "knowledge", "create")) return jsonError("Forbidden", 403);

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return jsonError("Invalid upload.", 422, "VALIDATION_ERROR");
  }
  if (!file) return jsonError("No file provided.", 422, "VALIDATION_ERROR");
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return jsonError("Please upload a PDF file.", 422, "VALIDATION_ERROR");
  }
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("That PDF is too large (max 15MB).", 422, "VALIDATION_ERROR");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractFromPdf(buffer);
    const suggestedTitle = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
    return jsonOk({ title: suggestedTitle || "Untitled PDF", content: result.content });
  } catch (err) {
    if (err instanceof ExtractionError) return jsonError(err.message, 422, "EXTRACTION_FAILED");
    // eslint-disable-next-line no-console
    console.error("[knowledge] PDF extraction failed unexpectedly:", err);
    return jsonError("Couldn't read that PDF.", 500);
  }
}

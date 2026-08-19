import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { startConversation } from "@/modules/conversations/engine";

const bodySchema = z
  .object({
    // Legacy <script data-agent="...">; new-style <script data-widget="...">
    // (multi-agent-routing spec Part A §5). Exactly one must be present —
    // startConversation() resolves either through the same Widget
    // machinery either way, see modules/conversations/engine.ts.
    publicAgentId: z.string().optional(),
    publicWidgetId: z.string().optional(),
    sessionId: z.string(),
    channel: z.enum(["WEBSITE", "WHATSAPP", "INSTAGRAM", "MESSENGER"]).default("WEBSITE"),
    landingPage: z.string().optional(),
    referringUrl: z.string().optional(),
    currentPage: z.string().optional(),
    utmSource: z.string().optional(),
    utmMedium: z.string().optional(),
    utmCampaign: z.string().optional(),
    utmContent: z.string().optional(),
    utmTerm: z.string().optional(),
    gclid: z.string().optional(),
    fbclid: z.string().optional(),
    consentAcknowledged: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.publicAgentId || v.publicWidgetId), { message: "publicAgentId or publicWidgetId is required" });

// Creates (or resumes) a widget conversation. This is the entry point of the
// "Advertising -> Conversation -> AI Sales Agent" loop the whole platform is
// built around (spec: opening paragraph). Core logic lives in
// modules/conversations/engine.ts so the demo-journey script exercises the
// exact same path as a real widget install.
export async function POST(req: NextRequest) {
  if (!(await rateLimit(req.headers.get("x-forwarded-for") || "widget", 30, 60_000))) {
    return jsonError("Too many requests", 429);
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  try {
    const result = await startConversation(parsed.data);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Unable to start conversation", 404);
  }
}

import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md section 4 Step 3 / docs/ONBOARDING_TASKS.md
// Milestone 4 — deliberately scoped to the two options that are real right
// now: add products manually (writes to the same `products` table
// src/app/api/internal/products/route.ts uses — no parallel product
// model), or skip. Scan Website / Upload Catalogue / Upload Price List /
// Upload Documents need a PDF-parsing + scraping decision this milestone
// doesn't make (see BUILD_NOTES.md §10 and docs/ONBOARDING_TASKS.md
// backlog) — the wizard UI marks those "Coming soon" rather than faking
// them.
const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
  currency: z.string().default("UGX"),
});

const bodySchema = z.union([
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("add_products"), products: z.array(productSchema).min(1) }),
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  await logOnboardingEvent(session.tenantId, "knowledge_import_started", { action: parsed.data.action });

  let createdProductIds: string[] = [];
  if (parsed.data.action === "add_products") {
    createdProductIds = await Promise.all(
      parsed.data.products.map(async (p) => {
        const id = generateId();
        await db.insert(schema.products).values({ id, tenantId: session.tenantId, ...p });
        return id;
      })
    );
    await logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "product.created",
      entity: "product",
      after: { count: createdProductIds.length, source: "onboarding" },
    });
  }

  const progress = await advanceOnboardingStep(session.tenantId, "KNOWLEDGE_IMPORT", "AGENT_SETUP");
  await logOnboardingEvent(session.tenantId, "knowledge_import_completed", {
    action: parsed.data.action,
    productsAdded: createdProductIds.length,
  });

  return jsonOk({ progress, productIds: createdProductIds });
}

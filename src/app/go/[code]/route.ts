import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { resolveTrackingLinkByCodeOnly, buildWhatsAppDeepLink } from "@/modules/influencers/tracking-links";
import crypto from "crypto";

// Public redirect endpoint a creator's shared link actually points at —
// unauthenticated by design, same as the public widget/webhook routes.
// Logs a ReferralClick then redirects to the real destination (spec:
// docs/PHASE_2_TASKS.md Milestone 4's definition of done).
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const link = await resolveTrackingLinkByCodeOnly(params.code);
  if (!link || link.status !== "ACTIVE") {
    return new NextResponse("This link is no longer active.", { status: 404 });
  }

  // Never store a raw IP — hash it (salted with the app's own encryption
  // key so it can't be rainbow-tabled back) purely for rough unique-click
  // estimation, not individual tracking.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
  const ipHash = ip ? crypto.createHash("sha256").update(ip + (process.env.ENCRYPTION_KEY || "")).digest("hex") : null;

  await db.insert(schema.referralClicks).values({
    id: generateId(),
    tenantId: link.tenantId,
    trackingLinkId: link.id,
    ipHash,
    userAgent: req.headers.get("user-agent") || null,
  });

  const destination =
    link.destinationType === "WHATSAPP" ? buildWhatsAppDeepLink(link.destinationValue, link.code) : link.destinationValue;

  return NextResponse.redirect(destination, { status: 302 });
}

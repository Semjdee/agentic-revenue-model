import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";

// ============================================================================
// Tracking links (docs/PHASE_2_TASKS.md Milestone 4).
//
// A tracking link is what a creator actually shares — a short
// `<APP_URL>/go/<code>` URL. Visiting it (src/app/go/[code]/route.ts)
// logs a ReferralClick and redirects to the real destination: either a
// WhatsApp deep link carrying a "Ref: <code>" prefilled message (which
// the WhatsApp webhook detects on the inbound reply — see Milestone 5 in
// src/app/api/public/webhooks/whatsapp/route.ts) or a plain website URL.
// ============================================================================

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/1/i/l/o — avoids visual ambiguity when a creator reads a code aloud

function generateCode(length = 7): string {
  let out = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export async function createTrackingLink(params: {
  tenantId: string;
  influencerId: string;
  campaignName: string;
  contentLabel?: string;
  destinationType: "WHATSAPP" | "WEBSITE";
  destinationValue: string;
}) {
  // Collision is astronomically unlikely at this alphabet/length, but a
  // unique index backs this up regardless (schema.ts trackingLinks) —
  // retry a couple of times rather than trusting probability alone.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const [existing] = await db
      .select()
      .from(schema.trackingLinks)
      .where(and(eq(schema.trackingLinks.tenantId, params.tenantId), eq(schema.trackingLinks.code, code)))
      .limit(1);
    if (existing) continue;

    const id = generateId();
    await db.insert(schema.trackingLinks).values({
      id,
      tenantId: params.tenantId,
      influencerId: params.influencerId,
      code,
      campaignName: params.campaignName,
      contentLabel: params.contentLabel,
      destinationType: params.destinationType,
      destinationValue: params.destinationValue,
    });
    return { id, code };
  }
  throw new Error("Could not generate a unique tracking code — please try again.");
}

export async function resolveTrackingLink(tenantId: string, code: string) {
  const [link] = await db
    .select()
    .from(schema.trackingLinks)
    .where(and(eq(schema.trackingLinks.tenantId, tenantId), eq(schema.trackingLinks.code, code)))
    .limit(1);
  return link ?? null;
}

/** Cross-tenant lookup by code alone — codes are unique per tenant, not
 * globally, so /go/<code> (which has no tenant context) needs this to
 * find which tenant a click belongs to before it can log/redirect. */
export async function resolveTrackingLinkByCodeOnly(code: string) {
  const [link] = await db.select().from(schema.trackingLinks).where(eq(schema.trackingLinks.code, code)).limit(1);
  return link ?? null;
}

export function buildTrackingLinkUrl(code: string): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/go/${code}`;
}

/** Builds the wa.me deep link a WHATSAPP-destination tracking link redirects to, with the referral code prefilled as the message. */
export function buildWhatsAppDeepLink(phoneNumber: string, code: string): string {
  const digits = phoneNumber.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Ref: ${code}`)}`;
}

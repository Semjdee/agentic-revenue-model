import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { initiateTopup, TopupError } from "@/modules/billing/topup";

const bodySchema = z.object({
  packageId: z.enum(["custom", "pack_20", "pack_50", "pack_100"]),
  customAmountUsd: z.number().positive().optional(),
  phoneNumber: z.string().min(6),
  phoneCountryCode: z.string().min(1).default("256"), // Uganda
  mobileMoneyNetwork: z.enum(["MTN", "AIRTEL"]),
  email: z.string().email().optional(),
});

// Real Flutterwave mobile-money top-up (Master Product Architecture
// Update §26-28) — starts a charge and returns where to send the tenant
// to complete it. Credits are NOT granted here; only the webhook route
// (after a real server-side re-verification) ever calls grantCredits().
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const email = parsed.data.email ?? session.email;
  if (!email) return jsonError("An email address is required to complete a purchase.", 422, "VALIDATION_ERROR");

  const [firstName, ...rest] = session.name.trim().split(/\s+/);
  const lastName = rest.join(" ") || firstName;

  try {
    const result = await initiateTopup({
      tenantId: session.tenantId,
      packageId: parsed.data.packageId,
      customAmountUsd: parsed.data.customAmountUsd,
      mobileMoneyNetwork: parsed.data.mobileMoneyNetwork,
      redirectUrl: `${process.env.APP_URL || ""}/settings?topup=complete`,
      customer: {
        email,
        firstName: firstName || "Customer",
        lastName,
        phoneCountryCode: parsed.data.phoneCountryCode,
        phoneNumber: parsed.data.phoneNumber,
      },
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof TopupError) return jsonError(err.message, 422, "TOPUP_ERROR");
    // eslint-disable-next-line no-console
    console.error("[billing] top-up initiation failed:", err);
    return jsonError("Couldn't start that payment — please try again.", 500);
  }
}

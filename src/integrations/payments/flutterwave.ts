import crypto from "crypto";

// ============================================================================
// Flutterwave payment connector — real credit top-up purchases (Master
// Product Architecture Update §26-28). Same DEMO/MOCK discipline as every
// other connector in this codebase (src/integrations/*): a real
// implementation behind a clean interface, swapped for a clearly-labelled
// mock when no live credential is configured, so the full flow is
// testable end to end without a real Flutterwave account.
//
// Built against Flutterwave's current Orchestrator Direct Charge API
// (verified against developer.flutterwave.com on 2026-08-21 — this
// replaced their older v3 /v3/payments hosted-checkout API, so don't
// "fix" this back to that shape from memory/training data):
//   POST /orchestration/direct-charges  — creates the charge, returns
//     either a next_action.redirect_url (customer completes payment on a
//     Flutterwave-hosted page) or a push/OTP flow, depending on payment
//     method.
//   GET /charges/{id}  — server-side re-verification (never trust a
//     webhook payload alone).
//   Webhook: POST to our configured URL, authenticated via the
//     `flutterwave-signature` header — HMAC-SHA256 of the raw request
//     body using the dashboard-configured secret hash, NOT the older
//     plain-string `verif-hash` header some older integrations use.
//
// Scope decision: mobile money only for this pass (MTN/Airtel — the
// dominant payment method for this platform's Uganda-based tenant base),
// not card. Card payments on this API require client-side field-level
// encryption via Flutterwave's own JS SDK before anything reaches this
// backend — a materially bigger, separately-scoped frontend integration,
// not backend connector work. The PaymentMethod type below is structured
// so adding "card" later is additive, not a rewrite.
//
// NOT YET LIVE-TESTED against a real Flutterwave sandbox account (none
// exists in this environment) — the request/response shapes here are
// taken directly from Flutterwave's current published API reference, not
// guessed, but the first real top-up attempt against a live sandbox key
// should be treated as this connector's actual verification, same as any
// third-party integration built without live credentials to test against.
// ============================================================================

const SANDBOX_BASE_URL = "https://developersandbox-api.flutterwave.com";
const PRODUCTION_BASE_URL = "https://f4bexperience.flutterwave.com";

export interface FlutterwaveCustomer {
  email: string;
  firstName: string;
  lastName: string;
  phoneCountryCode: string; // e.g. "256" for Uganda
  phoneNumber: string;
}

export interface InitiateChargeParams {
  amountUsd: number;
  reference: string; // our own idempotency key — must be unique per attempt
  customer: FlutterwaveCustomer;
  redirectUrl: string;
  mobileMoneyNetwork: "MTN" | "AIRTEL";
}

export interface InitiateChargeResult {
  chargeId: string;
  status: string;
  /** Where to send the customer to complete payment — null if this
   * method resolves via a push/OTP prompt on their phone instead of a
   * page redirect. */
  redirectUrl: string | null;
  isMock: boolean;
}

export interface VerifyChargeResult {
  chargeId: string;
  status: "succeeded" | "pending" | "failed" | "voided" | "unknown";
  amountUsd: number;
  currency: string;
  reference: string;
  isMock: boolean;
}

export interface PaymentConnector {
  readonly isMock: boolean;
  initiateCharge(params: InitiateChargeParams): Promise<InitiateChargeResult>;
  verifyCharge(chargeId: string): Promise<VerifyChargeResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
}

class MockFlutterwaveConnector implements PaymentConnector {
  readonly isMock = true;

  async initiateCharge(params: InitiateChargeParams): Promise<InitiateChargeResult> {
    const chargeId = "mock_chg_" + crypto.randomBytes(8).toString("hex");
    // Use the URL API rather than string-concatenating "?..." — the
    // caller's redirectUrl can already carry its own query string (e.g.
    // "?topup=complete"), and a naive concat produces a malformed
    // "?a=1?b=2" URL. Caught live before shipping.
    const url = new URL(params.redirectUrl);
    url.searchParams.set("mock_charge_id", chargeId);
    url.searchParams.set("mock", "1");
    return { chargeId, status: "pending", redirectUrl: url.toString(), isMock: true };
  }

  async verifyCharge(chargeId: string): Promise<VerifyChargeResult> {
    // Mock always reports success — this is a demo path, real payment
    // status can never come from a fabricated call. Never used unless
    // FLUTTERWAVE_SECRET_KEY is unset, same as every other mock
    // connector in this codebase.
    return { chargeId, status: "succeeded", amountUsd: 0, currency: "USD", reference: chargeId, isMock: true };
  }

  verifyWebhookSignature(): boolean {
    return true; // no real webhook exists to forge in mock mode
  }
}

class RealFlutterwaveConnector implements PaymentConnector {
  readonly isMock = false;
  private baseUrl: string;

  constructor(private secretKey: string, private webhookSecretHash: string, sandbox: boolean) {
    this.baseUrl = sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
  }

  private headers(extra?: Record<string, string>) {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      "content-type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
      ...extra,
    };
  }

  async initiateCharge(params: InitiateChargeParams): Promise<InitiateChargeResult> {
    const res = await fetch(`${this.baseUrl}/orchestration/direct-charges`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        amount: params.amountUsd,
        currency: "USD",
        reference: params.reference,
        customer: {
          email: params.customer.email,
          name: { first: params.customer.firstName, last: params.customer.lastName },
          phone: { country_code: params.customer.phoneCountryCode, number: params.customer.phoneNumber },
        },
        payment_method: {
          type: "mobile_money",
          mobile_money: {
            country_code: params.customer.phoneCountryCode,
            network: params.mobileMoneyNetwork,
            phone_number: params.customer.phoneNumber,
          },
        },
        redirect_url: params.redirectUrl,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Flutterwave charge initiation failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const json = await res.json();
    const data = json?.data ?? {};
    return {
      chargeId: data.id,
      status: data.status ?? "pending",
      redirectUrl: data.next_action?.type === "redirect_url" ? data.next_action?.redirect_url?.url ?? null : null,
      isMock: false,
    };
  }

  async verifyCharge(chargeId: string): Promise<VerifyChargeResult> {
    const res = await fetch(`${this.baseUrl}/charges/${encodeURIComponent(chargeId)}`, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Flutterwave charge verification failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const json = await res.json();
    const data = json?.data ?? {};
    const status: VerifyChargeResult["status"] = ["succeeded", "pending", "failed", "voided"].includes(data.status) ? data.status : "unknown";
    return { chargeId, status, amountUsd: Number(data.amount ?? 0), currency: data.currency ?? "USD", reference: data.reference ?? "", isMock: false };
  }

  /** Never trust a webhook payload alone — this only confirms the
   * request really came from Flutterwave; the actual credit grant still
   * re-verifies via verifyCharge() against the live API before doing
   * anything (see the webhook route). */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader) return false;
    const computed = crypto.createHmac("sha256", this.webhookSecretHash).update(rawBody).digest("base64");
    try {
      return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signatureHeader));
    } catch {
      return false; // length mismatch etc. — definitely not a match
    }
  }
}

export function getPaymentConnector(): PaymentConnector {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  const webhookSecretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!secretKey || !webhookSecretHash) return new MockFlutterwaveConnector();
  const sandbox = process.env.FLUTTERWAVE_ENV !== "production";
  return new RealFlutterwaveConnector(secretKey, webhookSecretHash, sandbox);
}

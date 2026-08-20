import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { setSessionCookie } from "@/lib/auth";
import { consumeOAuthState } from "@/lib/oauth-state";
import { resolveOAuthUser, AmbiguousOAuthEmailError } from "@/modules/auth/oauth-link";
import { generateAppleClientSecret } from "@/lib/apple-client-secret";
import { logAudit } from "@/lib/audit";

interface AppleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  aud: string;
  iss: string;
  exp: number;
}

function loginErrorRedirect(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/login?authError=${code}`, req.url));
}

// Apple posts here as application/x-www-form-urlencoded (response_mode=
// form_post — see the /start route's comment), not a GET query string
// like Google's callback.
export async function POST(req: NextRequest) {
  const clientId = process.env.APPLE_CLIENT_ID;
  const clientSecret = generateAppleClientSecret();
  if (!clientId || !clientSecret) return loginErrorRedirect(req, "apple_not_configured");

  const form = await req.formData();
  const code = form.get("code")?.toString();
  const state = form.get("state")?.toString();
  // Only present on the user's very first authorization — Apple never
  // sends it again on subsequent logins, so it must be captured now or
  // not at all.
  const userJson = form.get("user")?.toString();

  if (!code || !state) return loginErrorRedirect(req, "apple_missing_params");

  const stateCheck = await consumeOAuthState("apple", state);
  if (!stateCheck.ok) return loginErrorRedirect(req, "apple_state_mismatch");

  const redirectUri = `${process.env.APP_URL || req.nextUrl.origin}/api/internal/auth/apple/callback`;

  const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
  });
  if (!tokenRes.ok) return loginErrorRedirect(req, "apple_token_exchange_failed");
  const tokenJson = (await tokenRes.json()) as { id_token?: string };
  if (!tokenJson.id_token) return loginErrorRedirect(req, "apple_no_id_token");

  // Same decode-not-JWKS-verify tradeoff as the Google callback — see its
  // comment; identical reasoning applies (direct server-to-server
  // exchange over TLS with Apple's own token endpoint).
  const claims = jwt.decode(tokenJson.id_token) as AppleIdTokenClaims | null;
  if (!claims || claims.aud !== clientId || claims.iss !== "https://appleid.apple.com" || claims.exp * 1000 < Date.now()) {
    return loginErrorRedirect(req, "apple_invalid_token");
  }

  let name: string | null = null;
  if (userJson) {
    try {
      const parsedUser = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string } };
      const full = [parsedUser.name?.firstName, parsedUser.name?.lastName].filter(Boolean).join(" ");
      name = full || null;
    } catch {
      // Malformed/absent — fall back to deriving a name from the email later.
    }
  }

  try {
    const resolved = await resolveOAuthUser({ provider: "APPLE", providerUserId: claims.sub, email: claims.email_verified ? claims.email ?? null : null, name });
    await setSessionCookie({ userId: resolved.userId, tenantId: resolved.tenantId, role: resolved.role, email: resolved.email, name: resolved.name });
    await logAudit({ tenantId: resolved.tenantId, userId: resolved.userId, action: resolved.isNewAccount ? "tenant.created" : "user.login", entity: "user", entityId: resolved.userId, source: "APP" });

    const returnTo = stateCheck.extra?.returnTo || "/dashboard";
    return NextResponse.redirect(new URL(resolved.isNewAccount ? "/onboarding" : returnTo, req.url));
  } catch (err) {
    if (err instanceof AmbiguousOAuthEmailError) return loginErrorRedirect(req, "ambiguous_email");
    throw err;
  }
}

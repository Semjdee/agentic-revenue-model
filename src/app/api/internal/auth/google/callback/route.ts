import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { setSessionCookie } from "@/lib/auth";
import { consumeOAuthState } from "@/lib/oauth-state";
import { resolveOAuthUser, AmbiguousOAuthEmailError } from "@/modules/auth/oauth-link";
import { logAudit } from "@/lib/audit";

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  aud: string;
  iss: string;
  exp: number;
}

function loginErrorRedirect(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`/login?authError=${code}`, req.url));
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return loginErrorRedirect(req, "google_not_configured");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return loginErrorRedirect(req, "google_missing_params");

  const stateCheck = await consumeOAuthState("google", state);
  if (!stateCheck.ok) return loginErrorRedirect(req, "google_state_mismatch");

  const redirectUri = `${process.env.APP_URL || req.nextUrl.origin}/api/internal/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
  });
  if (!tokenRes.ok) return loginErrorRedirect(req, "google_token_exchange_failed");
  const tokenJson = (await tokenRes.json()) as { id_token?: string };
  if (!tokenJson.id_token) return loginErrorRedirect(req, "google_no_id_token");

  // Decoded, not signature-verified against Google's JWKS — acceptable
  // here because the id_token arrived over a direct, TLS-authenticated
  // server-to-server call to Google's own token endpoint (not passed
  // through the browser), but full JWKS verification is the documented
  // hardening step before this handles real account security at scale.
  const claims = jwt.decode(tokenJson.id_token) as GoogleIdTokenClaims | null;
  if (!claims || claims.aud !== clientId || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) || claims.exp * 1000 < Date.now()) {
    return loginErrorRedirect(req, "google_invalid_token");
  }

  try {
    const resolved = await resolveOAuthUser({ provider: "GOOGLE", providerUserId: claims.sub, email: claims.email_verified ? claims.email ?? null : null, name: claims.name ?? null });
    await setSessionCookie({ userId: resolved.userId, tenantId: resolved.tenantId, role: resolved.role, email: resolved.email, name: resolved.name });
    await logAudit({ tenantId: resolved.tenantId, userId: resolved.userId, action: resolved.isNewAccount ? "tenant.created" : "user.login", entity: "user", entityId: resolved.userId, source: "APP" });

    const returnTo = stateCheck.extra?.returnTo || "/dashboard";
    return NextResponse.redirect(new URL(resolved.isNewAccount ? "/onboarding" : returnTo, req.url));
  } catch (err) {
    if (err instanceof AmbiguousOAuthEmailError) return loginErrorRedirect(req, "ambiguous_email");
    throw err;
  }
}

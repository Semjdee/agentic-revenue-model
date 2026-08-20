import { NextRequest, NextResponse } from "next/server";
import { issueOAuthState } from "@/lib/oauth-state";

// Real "Sign in with Apple" — genuine redirect to appleid.apple.com.
// Activates once APPLE_CLIENT_ID (the Services ID configured in Apple
// Developer) is set; the callback additionally needs APPLE_TEAM_ID /
// APPLE_KEY_ID / APPLE_PRIVATE_KEY to complete the token exchange (see
// lib/apple-client-secret.ts). response_mode=form_post is mandatory here
// — it's the only mode Apple supports once `email`/`name` scopes are
// requested, which is why the callback route accepts POST, not GET.
export async function GET(req: NextRequest) {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?authError=apple_not_configured", req.url));
  }

  const returnToRaw = req.nextUrl.searchParams.get("return_to") || "/dashboard";
  const returnTo = returnToRaw.startsWith("/") && !returnToRaw.startsWith("//") ? returnToRaw : "/dashboard";

  const state = await issueOAuthState("apple", { returnTo });
  const redirectUri = `${process.env.APP_URL || req.nextUrl.origin}/api/internal/auth/apple/callback`;

  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString());
}

import { NextRequest, NextResponse } from "next/server";
import { issueOAuthState } from "@/lib/oauth-state";

// Real "Sign in with Google" — genuine redirect to accounts.google.com,
// not a mock consent screen. Activates automatically once
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set (same pattern as
// ANTHROPIC_API_KEY: the code is fully real and ready, it just needs
// real credentials to actually run against Google's servers). Until
// configured, this degrades to a clear redirect-with-message instead of
// a broken OAuth attempt.
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?authError=google_not_configured", req.url));
  }

  const returnToRaw = req.nextUrl.searchParams.get("return_to") || "/dashboard";
  const returnTo = returnToRaw.startsWith("/") && !returnToRaw.startsWith("//") ? returnToRaw : "/dashboard";

  const state = await issueOAuthState("google", { returnTo });
  const redirectUri = `${process.env.APP_URL || req.nextUrl.origin}/api/internal/auth/google/callback`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(url.toString());
}

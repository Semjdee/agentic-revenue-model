import { cookies } from "next/headers";
import crypto from "crypto";

// CSRF protection for the Google/Apple sign-in redirect dance. There's no
// session yet at this point (that's the whole point of logging in), so
// the `state` value can't be tied to one the way an authenticated action
// would be — instead it's round-tripped through a short-lived httpOnly
// cookie set right before the redirect to the provider, and checked
// against the `state` the provider hands back on its callback. Same
// "state issued and validated server-side, never trusted from a query
// param alone" discipline as the WhatsApp/Instagram/CRM connect flows
// (src/integrations/oauth/connect-flow.ts) — this is the equivalent for
// logging a user IN rather than connecting a channel.
const COOKIE_PREFIX = "ara_oauth_state_";

export async function issueOAuthState(provider: string, extra?: Record<string, string>): Promise<string> {
  const state = crypto.randomBytes(24).toString("hex");
  const store = await cookies();
  store.set(`${COOKIE_PREFIX}${provider}`, JSON.stringify({ state, ...extra }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return state;
}

export async function consumeOAuthState(provider: string, receivedState: string): Promise<{ ok: boolean; extra?: Record<string, string> }> {
  const store = await cookies();
  const raw = store.get(`${COOKIE_PREFIX}${provider}`)?.value;
  store.delete(`${COOKIE_PREFIX}${provider}`);
  if (!raw) return { ok: false };
  try {
    const parsed = JSON.parse(raw) as { state: string } & Record<string, string>;
    if (parsed.state !== receivedState) return { ok: false };
    const extra: Record<string, string> = { ...parsed };
    delete extra.state;
    return { ok: true, extra };
  } catch {
    return { ok: false };
  }
}

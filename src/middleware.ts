import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Hostname-based split between the tenant-facing app and the
// platform-admin surface — the actual enforcement point for "admin lives
// on its own subdomain, not just its own path" (the /platform/** route
// group + separate session in src/lib/platform-auth.ts already keep the
// two auth systems isolated; this is what makes them unreachable from
// each other's HOST as well, not just logically separate).
//
// ADMIN_HOSTNAME is set as an env var on the SECOND Netlify site only
// (e.g. "agenticsale-admin.netlify.app", or a real subdomain like
// "admin.yourdomain.com" once a custom domain exists) — both sites
// deploy from the exact same repo/build, this env var is the only thing
// that tells one of them "you are the admin site."
//
//   - Request arrives on the admin hostname  -> only /platform/** (and
//     Next's own internals/static assets) are served; anything else
//     redirects to /platform/login. This deployment IS the admin app,
//     nothing else.
//   - Request arrives on any other hostname (the main app)  -> /platform/**
//     is blocked outright (404), so even someone who knows the URL can't
//     reach the admin surface from the tenant-facing domain anymore.
//   - ADMIN_HOSTNAME not set at all (not configured yet) -> no gating,
//     both surfaces stay reachable on one host, exactly like before this
//     change — non-breaking until the second site exists.
export function middleware(req: NextRequest) {
  const adminHostname = process.env.ADMIN_HOSTNAME;
  if (!adminHostname) return NextResponse.next();

  const host = req.headers.get("host") || "";
  const isAdminHost = host === adminHostname || host.startsWith(`${adminHostname}:`); // allow a trailing :port in local testing
  const isPlatformPath = req.nextUrl.pathname.startsWith("/platform") || req.nextUrl.pathname.startsWith("/api/platform");

  if (isAdminHost) {
    if (isPlatformPath) return NextResponse.next();
    // Any other API route (tenant-internal, public widget) has no
    // business responding on the admin host — 404, not a redirect,
    // since a redirected API call just breaks confusingly instead of
    // failing cleanly.
    if (req.nextUrl.pathname.startsWith("/api")) return new NextResponse("Not found", { status: 404 });
    const url = req.nextUrl.clone();
    url.pathname = "/platform/login";
    return NextResponse.redirect(url);
  }

  if (isPlatformPath) {
    return new NextResponse("Not found", { status: 404 });
  }

  return NextResponse.next();
}

// Runs on everything except Next's own static/image assets — those need
// to load regardless of which host served the page.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

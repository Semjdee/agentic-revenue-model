"use client";

// Plain links, not fetch() calls — these need a real full-page navigation
// to Google's/Apple's own domain, not an XHR (browsers won't let a
// cross-origin login redirect happen via fetch/JS anyway, and it
// shouldn't: the whole point is the user sees Google's/Apple's own
// address bar before entering credentials there, not ours).
export function OAuthButtons({ returnTo }: { returnTo?: string }) {
  const qs = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
  return (
    <div className="space-y-2">
      <a
        href={`/api/internal/auth/google/start${qs}`}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-black/10 dark:border-white/15 bg-surface hover:bg-black/[0.02] dark:hover:bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-ink-primary"
      >
        <svg width="16" height="16" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.5 3 24 3c-7.6 0-14.2 4.3-17.7 10.7z" />
          <path fill="#4CAF50" d="M24 45c5.4 0 10.3-1.9 14.1-5.1l-6.5-5.5C29.5 36 26.9 37 24 37c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.7 40.6 16.3 45 24 45z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.4 36 44 30.5 44 24c0-1.4-.1-2.7-.4-3.5z" />
        </svg>
        Continue with Google
      </a>
      <a
        href={`/api/internal/auth/apple/start${qs}`}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-black hover:bg-black/85 px-4 py-2 text-[13px] font-medium text-white"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
        Continue with Apple
      </a>
    </div>
  );
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google sign-in isn't set up on this workspace yet.",
  apple_not_configured: "Apple sign-in isn't set up on this workspace yet.",
  google_state_mismatch: "That sign-in request expired — please try again.",
  apple_state_mismatch: "That sign-in request expired — please try again.",
  google_token_exchange_failed: "Google couldn't complete sign-in — please try again.",
  apple_token_exchange_failed: "Apple couldn't complete sign-in — please try again.",
  google_invalid_token: "Google's response couldn't be verified — please try again.",
  apple_invalid_token: "Apple's response couldn't be verified — please try again.",
  ambiguous_email: "More than one account already uses this email — please sign in with a password instead.",
};

export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] || "Sign-in didn't complete — please try again.";
}

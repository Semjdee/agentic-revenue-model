import jwt from "jsonwebtoken";

// "Sign in with Apple" doesn't use a static client secret — Apple requires
// a fresh ES256-signed JWT, generated server-side from your Apple
// Developer private key (the .p8 file), every time you exchange an
// authorization code. Needs APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_CLIENT_ID
// (the Services ID) / APPLE_PRIVATE_KEY (the .p8 file's contents,
// PEM-formatted, newlines as \n if stored in a single env var).
export function generateAppleClientSecret(): string | null {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKeyRaw = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !keyId || !clientId || !privateKeyRaw) return null;

  // Env vars can't hold real newlines cleanly in most hosting UIs
  // (including Netlify's), so the PEM is typically stored with literal
  // "\n" sequences that need converting back to real line breaks.
  const privateKey = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: teamId, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId }, privateKey, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: keyId },
  });
}

import zxcvbn from "zxcvbn";

// Audit finding F-4: an 8-character minimum alone lets through plenty of
// genuinely weak passwords ("password1", "raygrid2026") while blocking
// some strong ones that happen to be short. zxcvbn scores realistic
// crack-resistance (dictionary words, keyboard patterns, l33t substitution,
// dates) instead of just counting characters — the same approach used by
// Dropbox, GitLab, and 1Password's own strength meters.
//
// Score is 0-4 (zxcvbn's own scale). Rejecting below 2 ("somewhat
// guessable") blocks the worst offenders without being so strict that a
// legitimate business owner in a hurry gives up on signup — this is a
// judgement call, not a hard security requirement, so it's a named
// constant rather than buried inline.
export const MIN_PASSWORD_SCORE = 2;

export interface PasswordStrengthResult {
  score: number; // 0 (weakest) - 4 (strongest)
  ok: boolean;
  warning: string | null;
  suggestions: string[];
}

/** userInputs: things the password shouldn't just be a variant of — email,
 * name, company name. zxcvbn penalizes a password that's a trivial
 * transform of these ("raygrid123" for a RayGrid signup) even though it
 * wouldn't otherwise look weak. */
export function checkPasswordStrength(password: string, userInputs: string[] = []): PasswordStrengthResult {
  const result = zxcvbn(password, userInputs.filter(Boolean));
  return {
    score: result.score,
    ok: result.score >= MIN_PASSWORD_SCORE,
    warning: result.feedback.warning || null,
    suggestions: result.feedback.suggestions,
  };
}

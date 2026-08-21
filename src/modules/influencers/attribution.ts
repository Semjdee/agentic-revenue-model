// Referral-token detection (docs/PHASE_2_TASKS.md Milestone 5, spec
// section 24's 5-step flow): "Ref: <code>" appearing in an inbound
// message. Kept as a plain regex match rather than requiring the token
// to be the entire message, since a customer might type "hi Ref: ab12cd3
// I'm interested" rather than send the referral text untouched.
//
// Once a code is extracted and resolved to a tracking link (see
// modules/influencers/tracking-links.ts), the actual attribution touch
// is produced by passing the resolution through to
// startChannelConversation()'s `referral` param (modules/conversations/
// engine.ts) — it sets utmSource/utmCampaign/utmContent + influencerId/
// trackingLinkId directly on the new conversation row, so 100% of the
// existing UTM-driven attribution machinery (conversationToTouch in
// modules/attribution/service.ts) picks it up automatically. No parallel
// touch-recording path needed.
const REF_TOKEN_PATTERN = /\bRef:\s*([a-z0-9]{4,12})\b/i;

export function extractReferralCode(message: string): string | null {
  const match = message.match(REF_TOKEN_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/**
 * True when a message is JUST the referral token WhatsApp prefilled from
 * the tracking link's deep link (buildWhatsAppDeepLink) — nothing else.
 * That's a tracking payload, not a real customer utterance, and matters
 * because the AI's slot-filling qualification flow (mock-provider.ts /
 * the real LLM prompt) treats every inbound message as an answer to
 * whatever question is next — passing "Ref: ab12cd3" through unfiltered
 * would silently consume "what are you looking for" or "what's your
 * name" with tracking noise. The caller (startChannelConversation) uses
 * this to record the conversation/attribution but skip generating an AI
 * reply for this specific message, so the customer's actual first reply
 * is what starts qualification.
 */
export function isReferralOnlyMessage(message: string): boolean {
  return message.replace(REF_TOKEN_PATTERN, "").trim().length === 0;
}

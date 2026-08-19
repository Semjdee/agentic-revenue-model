// Shared human-readable labels for channel/source values — used by the
// Leads filter, the Contacts/Leads client dialog, and anywhere else a raw
// "whatsapp" | "instagram" | "website" | UTM-source string needs to be
// shown to a business owner instead of the internal value. Falls back to
// the raw value for anything not listed, so a new channel/UTM source
// never disappears — it just shows its own name until someone adds a
// nicer label here.
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  website: "Website",
  google: "Google",
  meta: "Meta / Facebook",
  tiktok: "TikTok",
  direct: "Direct",
};

export function channelLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return CHANNEL_LABELS[value.toLowerCase()] ?? value;
}

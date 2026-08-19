import { randomUUID, randomBytes } from "crypto";

export function generateId(): string {
  return randomUUID();
}

/** Public-facing agent id, safe to embed in browser widget snippets. */
export function generatePublicAgentId(): string {
  return "agent_" + randomBytes(12).toString("hex");
}

/** Public-facing widget id for the new <script data-widget="..."> embed
 * (multi-agent-routing spec Part A). Legacy data-agent embeds keep using
 * generatePublicAgentId() above — this is only for widgets created going
 * forward or via the new install flow. */
export function generatePublicWidgetId(): string {
  return "widget_" + randomBytes(12).toString("hex");
}

export function generateApiKeyPair(): { prefix: string; secret: string; full: string } {
  const prefix = "ark_" + randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("hex");
  return { prefix, secret, full: `${prefix}.${secret}` };
}

export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("hex");
}

export function generateSessionId(): string {
  return "sess_" + randomBytes(16).toString("hex");
}

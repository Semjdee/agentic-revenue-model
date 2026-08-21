import type { Role } from "@/db/schema";

// Static resource:action permission matrix (section 23 — "Create role-based
// permissions"). Kept in code rather than a DB table for MVP simplicity;
// see BUILD_NOTES.md. Swapping to a DB-backed Permission table later is a
// drop-in change since all checks go through hasPermission().
export type Resource =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "leads"
  | "opportunities"
  | "agents"
  | "knowledge"
  | "followups"
  | "advertising"
  | "influencers"
  | "attribution"
  | "reports"
  | "integrations"
  | "developer"
  | "team"
  | "settings"
  | "audit"
  | "approvals";

export type Action = "view" | "create" | "edit" | "delete" | "approve";

const FULL: Record<Resource, Action[]> = {
  dashboard: ["view"],
  inbox: ["view", "create", "edit", "delete"],
  contacts: ["view", "create", "edit", "delete"],
  leads: ["view", "create", "edit", "delete"],
  opportunities: ["view", "create", "edit", "delete"],
  agents: ["view", "create", "edit", "delete"],
  knowledge: ["view", "create", "edit", "delete"],
  followups: ["view", "create", "edit", "delete"],
  advertising: ["view", "create", "edit", "delete", "approve"],
  influencers: ["view", "create", "edit", "delete", "approve"],
  attribution: ["view"],
  reports: ["view"],
  integrations: ["view", "create", "edit", "delete"],
  developer: ["view", "create", "edit", "delete"],
  team: ["view", "create", "edit", "delete"],
  settings: ["view", "edit"],
  audit: ["view"],
  approvals: ["view", "approve"],
};

const READ_ONLY: Record<Resource, Action[]> = Object.fromEntries(
  Object.keys(FULL).map((k) => [k, ["view"]])
) as Record<Resource, Action[]>;

export const ROLE_PERMISSIONS: Record<Role, Record<Resource, Action[]>> = {
  OWNER: FULL,
  ADMIN: FULL,
  MANAGER: {
    ...FULL,
    team: ["view"],
    settings: ["view"],
    developer: ["view"],
  },
  SALES: {
    ...READ_ONLY,
    inbox: ["view", "create", "edit"],
    contacts: ["view", "create", "edit"],
    leads: ["view", "create", "edit"],
    opportunities: ["view", "create", "edit"],
    followups: ["view", "create", "edit"],
  },
  MARKETING: {
    ...READ_ONLY,
    advertising: ["view", "create", "edit"],
    influencers: ["view", "create", "edit"],
    attribution: ["view"],
    knowledge: ["view", "create", "edit"],
  },
  AGENT: {
    ...READ_ONLY,
    inbox: ["view", "create", "edit"],
    contacts: ["view", "edit"],
  },
  VIEWER: READ_ONLY,
  DEVELOPER: {
    ...READ_ONLY,
    developer: ["view", "create", "edit", "delete"],
    integrations: ["view", "create", "edit", "delete"],
  },
};

export function hasPermission(role: Role, resource: Resource, action: Action): boolean {
  const perms = ROLE_PERMISSIONS[role]?.[resource] ?? [];
  return perms.includes(action);
}

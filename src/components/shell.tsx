"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Inbox,
  Users,
  TrendingUp,
  Bot,
  BookOpen,
  CalendarClock,
  Megaphone,
  Route as RouteIcon,
  BarChart3,
  Plug,
  Code2,
  UserCog,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { hasPermission, type Resource } from "@/lib/permissions";
import type { Role } from "@/db/schema";
import { api } from "@/lib/api-client";

const NAV: { href: string; label: string; icon: React.ElementType; resource: Resource }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, resource: "dashboard" },
  { href: "/inbox", label: "Inbox", icon: Inbox, resource: "inbox" },
  { href: "/contacts", label: "Contacts", icon: Users, resource: "contacts" },
  { href: "/leads", label: "Leads", icon: TrendingUp, resource: "leads" },
  { href: "/agents", label: "AI Agents", icon: Bot, resource: "agents" },
  { href: "/knowledge", label: "Knowledge Base", icon: BookOpen, resource: "knowledge" },
  { href: "/followups", label: "Follow-ups", icon: CalendarClock, resource: "followups" },
  { href: "/advertising", label: "Advertising", icon: Megaphone, resource: "advertising" },
  { href: "/attribution", label: "Attribution", icon: RouteIcon, resource: "attribution" },
  { href: "/reports", label: "Reports", icon: BarChart3, resource: "reports" },
  { href: "/integrations", label: "Integrations", icon: Plug, resource: "integrations" },
  { href: "/developers", label: "Developers/API", icon: Code2, resource: "developer" },
  { href: "/team", label: "Team", icon: UserCog, resource: "team" },
  { href: "/settings", label: "Settings", icon: Settings, resource: "settings" },
];

export function Shell({
  session,
  children,
}: {
  session: { name: string; email: string; role: Role };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = NAV.filter((item) => hasPermission(session.role, item.resource, "view"));

  async function logout() {
    await api.post("/api/internal/auth/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex bg-plane">
      {/* Mobile topbar */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 bg-surface border-b border-black/10 dark:border-white/10 flex items-center justify-between px-4 z-40">
        <span className="font-semibold text-ink-primary">Revenue Agent</span>
        <button onClick={() => setMobileOpen((v) => !v)} className="p-2 text-ink-secondary">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <aside
        className={`fixed md:sticky top-0 md:top-0 h-screen w-64 shrink-0 bg-surface border-r border-black/10 dark:border-white/10 flex flex-col z-30 transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="h-14 flex items-center px-5 border-b border-black/10 dark:border-white/10">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-white text-xs font-bold mr-2">
            RA
          </div>
          <span className="font-semibold text-ink-primary text-[15px]">Revenue Agent</span>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200 font-medium"
                    : "text-ink-secondary hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.3 : 1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">
              {session.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-primary truncate">{session.name}</p>
              <p className="text-[11px] text-ink-muted truncate">{session.role}</p>
            </div>
            <button onClick={logout} title="Log out" className="p-1.5 text-ink-muted hover:text-ink-primary">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="md:hidden fixed inset-0 bg-black/30 z-20" onClick={() => setMobileOpen(false)} />}

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>
    </div>
  );
}

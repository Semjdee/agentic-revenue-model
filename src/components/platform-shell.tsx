"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut } from "lucide-react";
import { api } from "@/lib/api-client";
import clsx from "clsx";
import type { PlatformSessionPayload } from "@/lib/platform-auth";

const NAV = [{ href: "/platform/dashboard", label: "Dashboard", icon: LayoutDashboard }];

export function PlatformShell({ session, children }: { session: PlatformSessionPayload; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api.post("/api/platform/auth/logout");
    router.push("/platform/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] text-white">
      <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-[12px] font-bold">P</div>
          <span className="font-semibold text-[14px]">Platform Admin</span>
          <nav className="flex items-center gap-1 ml-6">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px]",
                  pathname === item.href ? "bg-white/10 text-white" : "text-white/60 hover:text-white/90"
                )}
              >
                <item.icon size={13} /> {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-white/60">
          <span>
            {session.name} · <span className="text-white/40">{session.role}</span>
          </span>
          <button onClick={logout} className="flex items-center gap-1 hover:text-white">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </div>
      <div className="px-6 py-6">{children}</div>
    </div>
  );
}

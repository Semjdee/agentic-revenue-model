import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { PlatformShell } from "@/components/platform-shell";

export default async function PlatformDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");

  return <PlatformShell session={session}>{children}</PlatformShell>;
}

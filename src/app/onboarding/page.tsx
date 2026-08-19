import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { OnboardingWizard } from "./wizard";

// Standalone route (not under the `(app)` group) — deliberately outside
// the normal back-office chrome (Shell/nav) per docs/ONBOARDING_SPEC.md
// section 3: don't let a new user wander into unconfigured areas of the
// app before they've finished setup. Same auth pattern as
// src/app/(app)/layout.tsx (getSession + redirect), just without Shell.
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <OnboardingWizard session={{ tenantId: session.tenantId, name: session.name, role: session.role }} />;
}

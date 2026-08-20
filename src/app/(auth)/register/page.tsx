"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import zxcvbn from "zxcvbn";
import { api } from "@/lib/api-client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OAuthButtons } from "@/components/oauth-buttons";
import { PhoneAuthForm } from "@/components/phone-auth-form";
import clsx from "clsx";

// Same MIN_PASSWORD_SCORE the server enforces (src/lib/password-strength.ts)
// — mirrored here (not imported) since that module pulls in the Node
// `zxcvbn` package server-side; keeping the constant in sync manually is a
// small enough surface that duplicating one number beats adding a
// server/client code-split for it.
const MIN_PASSWORD_SCORE = 2;
const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["#c0392b", "#e07b39", "#d4a017", "#4a9d4a", "#1e8a4c"];

export default function RegisterPage() {
  const router = useRouter();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => {
    if (!form.password) return null;
    return zxcvbn(form.password, [form.email, form.name, form.companyName].filter(Boolean));
  }, [form.password, form.email, form.name, form.companyName]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/internal/auth/register", form);
      router.push("/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white text-sm font-bold">RA</div>
          <span className="font-semibold text-ink-primary text-[16px]">Revenue Agent</span>
        </div>
        <div className="card p-6 space-y-4">
          <div>
            <h1 className="text-[16px] font-semibold text-ink-primary">Create your workspace</h1>
            <p className="text-[12.5px] text-ink-secondary mt-0.5">Set up your business in under a minute.</p>
          </div>

          <OAuthButtons returnTo="/onboarding" />

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
            <span className="text-[11px] text-ink-muted uppercase tracking-wide">or</span>
            <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
          </div>

          <div className="flex gap-1 bg-black/[0.04] dark:bg-white/10 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setMethod("email")}
              className={clsx("flex-1 py-1.5 rounded-md text-[12.5px] font-medium", method === "email" ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary")}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setMethod("phone")}
              className={clsx("flex-1 py-1.5 rounded-md text-[12.5px] font-medium", method === "phone" ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary")}
            >
              Phone
            </button>
          </div>

          {method === "email" ? (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <Label>Company name</Label>
                <Input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="RayGrid Solar Energy" />
              </div>
              <div>
                <Label>Your name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
                {strength && (
                  <div className="mt-1.5">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="h-1 flex-1 rounded-full transition-colors"
                          style={{ backgroundColor: i <= strength.score ? STRENGTH_COLORS[strength.score] : "rgba(0,0,0,0.08)" }}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: STRENGTH_COLORS[strength.score] }}>
                      {STRENGTH_LABELS[strength.score]}
                      {strength.score < MIN_PASSWORD_SCORE && strength.feedback.warning ? ` — ${strength.feedback.warning}` : ""}
                    </p>
                  </div>
                )}
              </div>
              {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
              <Button type="submit" disabled={loading || (strength !== null && strength.score < MIN_PASSWORD_SCORE)} className="w-full">
                {loading ? "Creating…" : "Create workspace"}
              </Button>
            </form>
          ) : (
            <PhoneAuthForm purpose="SIGNUP" onSuccess={(to) => router.push(to)} />
          )}

          <p className="text-[12.5px] text-ink-secondary text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-600 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

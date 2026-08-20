"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OAuthButtons, oauthErrorMessage } from "@/components/oauth-buttons";
import { PhoneAuthForm } from "@/components/phone-auth-form";
import clsx from "clsx";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const authError = oauthErrorMessage(params.get("authError"));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/internal/auth/login", { email, password });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-plane px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white text-sm font-bold">RA</div>
          <span className="font-semibold text-ink-primary text-[16px]">Revenue Agent</span>
        </div>
        <div className="card p-6 space-y-4">
          <div>
            <h1 className="text-[16px] font-semibold text-ink-primary">Sign in</h1>
            <p className="text-[12.5px] text-ink-secondary mt-0.5">Welcome back to your revenue operation.</p>
          </div>

          {authError && <p className="text-[12.5px] text-status-critical">{authError}</p>}

          <OAuthButtons />

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
                <Label>Email</Label>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : (
            <PhoneAuthForm purpose="LOGIN" onSuccess={(to) => router.push(to)} />
          )}

          <p className="text-[12.5px] text-ink-secondary text-center">
            No account yet?{" "}
            <Link href="/register" className="text-brand-600 font-medium">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

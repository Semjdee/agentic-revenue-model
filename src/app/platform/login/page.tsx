"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Deliberately its own page, not a variant of /(auth)/login — no Google/
// Apple/Phone options (this is a small, internally-provisioned staff
// list, not a self-service surface), and visually distinct dark styling
// so it never gets confused with a tenant's own login screen.
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/platform/auth/login", { email, password });
      router.push("/platform/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0f19] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-white text-sm font-bold">P</div>
          <span className="font-semibold text-white text-[16px]">Platform Admin</span>
        </div>
        <form onSubmit={onSubmit} className="rounded-xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <div>
            <h1 className="text-[15px] font-semibold text-white">Internal sign-in</h1>
            <p className="text-[12px] text-white/50 mt-0.5">Cross-tenant platform staff only — not for business accounts.</p>
          </div>
          <div>
            <Label className="text-white/70">Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white/5 border-white/15 text-white placeholder:text-white/30" />
          </div>
          <div>
            <Label className="text-white/70">Password</Label>
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-white/5 border-white/15 text-white placeholder:text-white/30" />
          </div>
          {error && <p className="text-[12.5px] text-red-400">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

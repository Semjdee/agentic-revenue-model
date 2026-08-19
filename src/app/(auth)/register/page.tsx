"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <div>
            <h1 className="text-[16px] font-semibold text-ink-primary">Create your workspace</h1>
            <p className="text-[12.5px] text-ink-secondary mt-0.5">Set up your business in under a minute.</p>
          </div>
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
          </div>
          {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating…" : "Create workspace"}
          </Button>
          <p className="text-[12.5px] text-ink-secondary text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-600 font-medium">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

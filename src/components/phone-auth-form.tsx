"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Shared phone + SMS-OTP form for both login and signup — same "one
// component, provider-agnostic where the logic actually is identical"
// discipline as this codebase's oauth-mock-consent-form.tsx. Two steps:
// enter phone -> enter the code that was texted. For SIGNUP, company/name
// are collected alongside the code (not before) so a mistyped phone
// number doesn't waste that typing.
export function PhoneAuthForm({ purpose, onSuccess }: { purpose: "LOGIN" | "SIGNUP"; onSuccess: (redirectTo: string) => void }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ sent: boolean; isMock: boolean; mockCode?: string }>("/api/internal/auth/phone/send-otp", { phone, purpose });
      setMockCode(res.isMock ? res.mockCode ?? null : null);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/internal/auth/phone/verify-otp", { phone, code, purpose, ...(purpose === "SIGNUP" ? { companyName, name } : {}) });
      onSuccess(purpose === "SIGNUP" ? "/onboarding" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify that code");
    } finally {
      setLoading(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <div>
          <Label>Phone number</Label>
          <Input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256700123456" />
          <p className="text-[11px] text-ink-muted mt-1">Include your country code, e.g. +256 for Uganda.</p>
        </div>
        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Sending…" : "Send verification code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="space-y-3">
      {mockCode && (
        <div className="rounded-lg border border-brand-300 bg-brand-50 dark:bg-brand-900/20 px-3 py-2 text-[12px] text-brand-700 dark:text-brand-300">
          <strong>Demo mode</strong> — no SMS provider is connected, so here&apos;s the code that would have been texted to {phone}: <strong>{mockCode}</strong>
        </div>
      )}
      <p className="text-[12.5px] text-ink-secondary">Enter the 6-digit code sent to {phone}.</p>
      <div>
        <Label>Verification code</Label>
        <Input required maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
      </div>
      {purpose === "SIGNUP" && (
        <>
          <div>
            <Label>Company name</Label>
            <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="RayGrid Solar Energy" />
          </div>
          <div>
            <Label>Your name</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
        </>
      )}
      {error && <p className="text-[12.5px] text-status-critical">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Verifying…" : purpose === "SIGNUP" ? "Create workspace" : "Sign in"}
      </Button>
      <button type="button" onClick={() => setStep("phone")} className="w-full text-center text-[12px] text-ink-muted hover:text-ink-secondary">
        Use a different number
      </button>
    </form>
  );
}

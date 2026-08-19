"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, User, ThumbsUp, ThumbsDown } from "lucide-react";
import clsx from "clsx";

// Shared "Test Agent" sandbox — docs/ONBOARDING_SPEC.md section 14 /
// addendum §A13: "same component, two entry points, not two
// implementations". Used by both src/app/onboarding/wizard.tsx (during
// setup) and src/app/(app)/agents/[id]/page.tsx (persistently, for any
// agent at any time). Talks to /api/internal/agents/[id]/test, which
// never writes to production CRM data — see src/modules/ai/sandbox.ts.

interface SandboxMessage {
  sender: "CUSTOMER" | "AI";
  content: string;
}

interface SandboxResult {
  message: string;
  escalate: boolean;
  leadScoreDelta: number;
  simulatedActions: { action: string; parameters: Record<string, unknown> }[];
}

const SUGGESTIONS = [
  "How much does it cost?",
  "Do you have this in stock?",
  "What's your delivery time?",
  "That's too expensive, any discount?",
  "Can I speak to a real person?",
  "Do you sell something for cars?",
];

export function TestAgentPanel({ agentId }: { agentId: string }) {
  const [messages, setMessages] = useState<SandboxMessage[]>([]);
  const [lastResult, setLastResult] = useState<SandboxResult | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<Record<number, string>>({});
  const [feedbackSent, setFeedbackSent] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function send(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    const nextHistory = [...messages, { sender: "CUSTOMER" as const, content }];
    setMessages(nextHistory);
    try {
      const result = await api.post<SandboxResult>(`/api/internal/agents/${agentId}/test`, {
        message: content,
        history: messages,
      });
      setLastResult(result);
      setMessages([...nextHistory, { sender: "AI", content: result.message }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test message failed");
    } finally {
      setSending(false);
    }
  }

  async function giveFeedback(index: number, verdict: "GOOD" | "NEEDS_IMPROVEMENT") {
    const aiMessage = messages[index];
    const customerMessage = messages[index - 1];
    if (!aiMessage || aiMessage.sender !== "AI") return;
    try {
      await api.post(`/api/internal/agents/${agentId}/test-feedback`, {
        testMessage: customerMessage?.content ?? "",
        aiResponse: aiMessage.content,
        verdict,
        correctionNote: verdict === "NEEDS_IMPROVEMENT" ? feedbackNote[index] : undefined,
      });
      setFeedbackSent(new Set([...feedbackSent, index]));
    } catch {
      // Non-critical — feedback is a nice-to-have, don't block testing on it.
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-black/10 dark:border-white/15 bg-plane p-3 min-h-[160px] max-h-[360px] overflow-y-auto space-y-2">
        {messages.length === 0 && (
          <p className="text-[12px] text-ink-muted">Pretend you&apos;re a customer. Try a question below, or type your own.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex flex-col", m.sender === "CUSTOMER" ? "items-start" : "items-end")}>
            <div
              className={clsx(
                "max-w-[80%] rounded-xl px-3 py-1.5 text-[12.5px]",
                m.sender === "CUSTOMER" ? "bg-black/[0.05] dark:bg-white/10 text-ink-primary" : "bg-brand-500 text-white"
              )}
            >
              <p className="text-[9.5px] opacity-70 mb-0.5 flex items-center gap-1">
                {m.sender === "CUSTOMER" ? <User size={9} /> : <Bot size={9} />} {m.sender === "CUSTOMER" ? "You (test)" : "AI"}
              </p>
              {m.content}
            </div>
            {m.sender === "AI" && !feedbackSent.has(i) && (
              <div className="flex items-center gap-1.5 mt-1">
                <button onClick={() => giveFeedback(i, "GOOD")} className="text-ink-muted hover:text-status-positive" title="Good response">
                  <ThumbsUp size={12} />
                </button>
                <button onClick={() => giveFeedback(i, "NEEDS_IMPROVEMENT")} className="text-ink-muted hover:text-status-critical" title="Needs improvement">
                  <ThumbsDown size={12} />
                </button>
                <Input
                  placeholder="What should it have said? (optional)"
                  className="!py-0.5 !text-[11px] w-52"
                  value={feedbackNote[i] ?? ""}
                  onChange={(e) => setFeedbackNote({ ...feedbackNote, [i]: e.target.value })}
                />
              </div>
            )}
            {m.sender === "AI" && feedbackSent.has(i) && <p className="text-[10.5px] text-ink-muted mt-0.5">Thanks — noted for review.</p>}
          </div>
        ))}
      </div>

      {lastResult && (lastResult.escalate || lastResult.simulatedActions.length > 0) && (
        <div className="text-[11px] text-ink-muted space-y-0.5">
          {lastResult.escalate && <p>→ Would hand off to a human here.</p>}
          {lastResult.simulatedActions.map((a, i) => (
            <p key={i}>→ Would: {a.action.replace(/_/g, " ")}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => send(s)}
            disabled={sending}
            className="text-[11px] px-2 py-1 rounded-full bg-black/[0.04] dark:bg-white/10 text-ink-secondary hover:bg-black/[0.08] disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a test message…"
          disabled={sending}
        />
        <Button onClick={() => send()} disabled={sending}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error && <p className="text-[12px] text-status-critical">{error}</p>}
    </div>
  );
}

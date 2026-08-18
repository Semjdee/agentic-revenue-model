"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, User, Send, UserCog, Flame } from "lucide-react";
import clsx from "clsx";

interface ConversationListItem {
  id: string;
  channel: string;
  aiActive: boolean;
  leadScore: number;
  unread: boolean;
  lastMessageAt: string;
  utmCampaign?: string | null;
  utmSource?: string | null;
  contact: { id: string; name: string | null; phone: string | null; email: string | null };
}

interface Message {
  id: string;
  sender: "CUSTOMER" | "AI" | "HUMAN" | "SYSTEM";
  content: string;
  createdAt: string;
}

const FILTERS = ["All", "Unread", "AI Active", "Human Active", "Hot Leads"] as const;

export default function InboxPage() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [detail, setDetail] = useState<{ conversation: ConversationListItem; messages: Message[] } | null>(null);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadList() {
    const rows = await api.get<ConversationListItem[]>("/api/internal/conversations");
    setConversations(rows);
    if (!selectedId && rows.length) setSelectedId(rows[0].id);
  }

  async function loadDetail(id: string) {
    const data = await api.get<{
      conversation: Omit<ConversationListItem, "contact">;
      contact: ConversationListItem["contact"];
      messages: Message[];
    }>(`/api/internal/conversations/${id}`);
    // The detail endpoint returns `contact` as a sibling of `conversation`
    // (see src/app/api/internal/conversations/[id]/route.ts), unlike the
    // list endpoint which nests it — normalize here so the rest of this
    // component can always read `conversation.contact`.
    setDetail({ conversation: { ...data.conversation, contact: data.contact }, messages: data.messages });
  }

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadList is stable across renders; only want this to run once on mount plus the poll interval
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
      const t = setInterval(() => loadDetail(selectedId), 4000);
      return () => clearInterval(t);
    }
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  async function send() {
    if (!draft.trim() || !selectedId) return;
    const content = draft;
    setDraft("");
    await api.post(`/api/internal/conversations/${selectedId}/messages`, { content });
    loadDetail(selectedId);
  }

  async function takeover() {
    if (!selectedId) return;
    await api.post(`/api/internal/conversations/${selectedId}/takeover`);
    loadDetail(selectedId);
  }
  async function returnToAI() {
    if (!selectedId) return;
    await api.post(`/api/internal/conversations/${selectedId}/return-to-ai`);
    loadDetail(selectedId);
  }

  const filtered = conversations.filter((c) => {
    if (filter === "Unread") return c.unread;
    if (filter === "AI Active") return c.aiActive;
    if (filter === "Human Active") return !c.aiActive;
    if (filter === "Hot Leads") return c.leadScore >= 60;
    return true;
  });

  return (
    <div className="h-screen flex flex-col md:pt-0">
      <div className="border-b border-black/10 dark:border-white/10 px-5 md:px-8 py-3 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-[16px] font-semibold text-ink-primary">Inbox</h1>
        <div className="flex gap-1 bg-black/[0.04] dark:bg-white/10 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx("px-2.5 py-1 rounded-md text-[12px] font-medium", filter === f ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-full sm:w-80 shrink-0 border-r border-black/10 dark:border-white/10 overflow-y-auto scrollbar-thin">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={clsx(
                "w-full text-left px-4 py-3 border-b border-black/[0.05] dark:border-white/[0.05] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
                selectedId === c.id && "bg-brand-50 dark:bg-brand-900/30"
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-ink-primary truncate">{c.contact.name || c.contact.phone || c.contact.email || "Anonymous visitor"}</p>
                {c.unread && <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge tone="neutral">{c.channel}</Badge>
                {c.aiActive ? <Badge tone="brand">AI Active</Badge> : <Badge tone="warning">Human</Badge>}
                {c.leadScore >= 60 && (
                  <Badge tone="serious">
                    <Flame size={10} className="inline mr-0.5" /> Hot
                  </Badge>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-[12.5px] text-ink-muted p-4">No conversations match this filter.</p>}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-[13px] text-ink-muted">Select a conversation</div>
          ) : (
            <>
              <div className="border-b border-black/10 dark:border-white/10 px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[13.5px] font-medium text-ink-primary">
                    {detail.conversation.contact.name || detail.conversation.contact.phone || detail.conversation.contact.email || "Anonymous visitor"}
                  </p>
                  <p className="text-[11.5px] text-ink-muted">
                    {detail.conversation.utmCampaign ? `via ${detail.conversation.utmCampaign}` : detail.conversation.utmSource || detail.conversation.channel}
                  </p>
                </div>
                {detail.conversation.aiActive ? (
                  <Button size="sm" variant="secondary" onClick={takeover}>
                    <UserCog size={13} /> Take Over
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={returnToAI}>
                    <Bot size={13} /> Return to AI
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
                {detail.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="border-t border-black/10 dark:border-white/10 p-3 flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder={detail.conversation.aiActive ? "Take over the conversation to reply as a human…" : "Type a message…"}
                  disabled={detail.conversation.aiActive}
                />
                <Button onClick={send} disabled={detail.conversation.aiActive}>
                  <Send size={14} />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isCustomer = message.sender === "CUSTOMER";
  return (
    <div className={clsx("flex", isCustomer ? "justify-start" : "justify-end")}>
      <div className={clsx("max-w-[75%] rounded-2xl px-3.5 py-2", isCustomer ? "bg-black/[0.05] dark:bg-white/10 text-ink-primary" : "bg-brand-500 text-white")}>
        {!isCustomer && (
          <p className="text-[10px] opacity-70 mb-0.5 flex items-center gap-1">
            {message.sender === "AI" ? <Bot size={10} /> : <User size={10} />} {message.sender}
          </p>
        )}
        <p className="text-[13px] whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

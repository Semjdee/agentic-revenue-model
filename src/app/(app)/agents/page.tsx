"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Plus, Bot } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  role: string | null;
  status: string;
  publicAgentId: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setAgents(await api.get<Agent[]>("/api/internal/agents"));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/api/internal/agents", {
      name,
      role: "Sales Assistant",
      qualificationQuestions: [
        "What are you looking for today?",
        "Could I get your name?",
        "What's the best phone number or email to reach you on?",
        "And where are you located, or is this for your home or business?",
      ],
    });
    setOpen(false);
    setName("");
    load();
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="AI Agents"
        description="Configure the AI Sales Agent(s) that talk to your customers."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> New Agent
          </Button>
        }
      />
      <div className="px-5 md:px-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
        {agents.map((a) => (
          <Link key={a.id} href={`/agents/${a.id}`} className="card p-4 hover:border-brand-300 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center">
                <Bot size={16} className="text-brand-600 dark:text-brand-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink-primary truncate">{a.name}</p>
                <p className="text-[12px] text-ink-secondary truncate">{a.role}</p>
              </div>
            </div>
            <div className="mt-3">
              <Badge tone={a.status === "ACTIVE" ? "good" : "neutral"}>{a.status}</Badge>
            </div>
          </Link>
        ))}
        {!loading && agents.length === 0 && (
          <div className="card p-10 text-center col-span-full">
            <Bot className="mx-auto mb-2 text-ink-muted" size={28} />
            <p className="text-[13.5px] text-ink-primary font-medium">No AI agents yet</p>
            <p className="text-[12.5px] text-ink-secondary mt-1">Create one to start qualifying leads automatically.</p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen} title="New AI Agent" description="You can fully configure it after creating.">
        <form onSubmit={create} className="space-y-4">
          <div>
            <Label>Agent name</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah — Sales Assistant" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Agent</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

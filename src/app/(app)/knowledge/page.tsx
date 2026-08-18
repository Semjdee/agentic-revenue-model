"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, Globe, HelpCircle, FileUp, Trash2, BookOpen } from "lucide-react";

interface Collection {
  id: string;
  name: string;
}
interface Doc {
  id: string;
  collectionId: string;
  title: string;
  content: string;
  sourceType: "MANUAL" | "URL" | "PDF" | "FAQ";
  sourceUrl?: string | null;
  status: string;
  createdAt: string;
}

const DEFAULT_COLLECTIONS = ["Products", "Pricing", "Warranty", "Delivery", "Company", "FAQs", "Sales Policies"];

const SOURCE_ICON: Record<string, React.ElementType> = { MANUAL: FileText, URL: Globe, FAQ: HelpCircle, PDF: FileUp };

export default function KnowledgeBasePage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    let cols = await api.get<Collection[]>("/api/internal/knowledge/collections");
    if (cols.length === 0) {
      for (const name of DEFAULT_COLLECTIONS) {
        await api.post("/api/internal/knowledge/collections", { name });
      }
      cols = await api.get<Collection[]>("/api/internal/knowledge/collections");
    }
    setCollections(cols);
    setActiveCollection((prev) => prev ?? cols[0]?.id ?? null);
    const allDocs = await api.get<Doc[]>("/api/internal/knowledge/documents");
    setDocs(allDocs);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function deleteDoc(id: string) {
    await api.del(`/api/internal/knowledge/documents/${id}`);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  const visibleDocs = docs.filter((d) => d.collectionId === activeCollection);

  return (
    <div className="pb-12">
      <PageHeader
        title="Knowledge Base"
        description="What your AI Sales Agent knows about your business — products, pricing, policies, FAQs."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={15} /> Add Knowledge
          </Button>
        }
      />

      <div className="px-5 md:px-8 grid md:grid-cols-[220px_1fr] gap-5">
        <div className="card p-2 h-fit">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCollection(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-[13px] flex items-center justify-between ${
                activeCollection === c.id ? "bg-brand-50 text-brand-700 font-medium dark:bg-brand-900/40 dark:text-brand-200" : "text-ink-secondary hover:bg-black/[0.03] dark:hover:bg-white/5"
              }`}
            >
              <span>{c.name}</span>
              <span className="text-[11px] text-ink-muted tabular-nums">{docs.filter((d) => d.collectionId === c.id).length}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {loading && <p className="text-[13px] text-ink-muted">Loading…</p>}
          {!loading && visibleDocs.length === 0 && (
            <div className="card p-10 text-center">
              <BookOpen className="mx-auto mb-2 text-ink-muted" size={28} />
              <p className="text-[13.5px] text-ink-primary font-medium">No knowledge here yet</p>
              <p className="text-[12.5px] text-ink-secondary mt-1">
                Add FAQs, policies, or business info so your AI Sales Agent can answer accurately instead of guessing.
              </p>
              <Button className="mt-3" onClick={() => setDialogOpen(true)}>
                <Plus size={15} /> Add Knowledge
              </Button>
            </div>
          )}
          {visibleDocs.map((doc) => {
            const Icon = SOURCE_ICON[doc.sourceType] ?? FileText;
            return (
              <div key={doc.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-black/[0.04] dark:bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon size={14} className="text-ink-secondary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13.5px] font-medium text-ink-primary truncate">{doc.title}</p>
                        <Badge tone="neutral">{doc.sourceType}</Badge>
                      </div>
                      <p className="text-[12.5px] text-ink-secondary mt-1 line-clamp-2 whitespace-pre-line">{doc.content}</p>
                    </div>
                  </div>
                  <button onClick={() => deleteDoc(doc.id)} className="p-1.5 text-ink-muted hover:text-status-critical shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AddKnowledgeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        collections={collections}
        defaultCollectionId={activeCollection}
        onCreated={(doc) => setDocs((prev) => [doc, ...prev])}
      />
    </div>
  );
}

function AddKnowledgeDialog({
  open,
  onOpenChange,
  collections,
  defaultCollectionId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collection[];
  defaultCollectionId: string | null;
  onCreated: (doc: Doc) => void;
}) {
  const [mode, setMode] = useState<"MANUAL" | "FAQ" | "URL">("MANUAL");
  const [collectionId, setCollectionId] = useState(defaultCollectionId ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCollectionId(defaultCollectionId ?? collections[0]?.id ?? "");
      setMode("MANUAL");
      setTitle("");
      setContent("");
      setQuestion("");
      setAnswer("");
      setSourceUrl("");
      setError(null);
    }
  }, [open, defaultCollectionId, collections]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const finalTitle = mode === "FAQ" ? question : title;
      const finalContent = mode === "FAQ" ? `Q: ${question}\nA: ${answer}` : content;
      if (!finalTitle.trim() || !finalContent.trim() || !collectionId) {
        throw new Error("Please fill in the required fields.");
      }
      const doc = await api.post<Doc>("/api/internal/knowledge/documents", {
        collectionId,
        title: finalTitle,
        content: finalContent,
        sourceType: mode,
        sourceUrl: mode === "URL" ? sourceUrl : undefined,
      });
      onCreated({ ...doc, collectionId, title: finalTitle, content: finalContent, sourceType: mode, status: "READY", createdAt: new Date().toISOString() } as Doc);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Knowledge"
      description="Teach your AI Sales Agent about your business. It will only ever answer from what you put here — never guess."
      widthClassName="max-w-xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-1 bg-black/[0.04] dark:bg-white/10 rounded-lg p-1 w-fit">
          {(["MANUAL", "FAQ", "URL"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium ${mode === m ? "bg-surface shadow-sm text-ink-primary" : "text-ink-secondary"}`}
            >
              {m === "MANUAL" ? "Text" : m === "FAQ" ? "FAQ" : "Website URL"}
            </button>
          ))}
          <button type="button" disabled title="Coming soon" className="px-3 py-1.5 rounded-md text-[12.5px] text-ink-muted opacity-50 cursor-not-allowed">
            PDF
          </button>
        </div>

        <div>
          <Label>Collection</Label>
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px] text-ink-primary"
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {mode === "MANUAL" && (
          <>
            <div>
              <Label>Title</Label>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Return & refund policy" />
            </div>
            <div>
              <Label>Content</Label>
              <Textarea
                required
                rows={7}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste or type the information — policies, product details, company info, delivery times, warranty terms…"
              />
            </div>
          </>
        )}

        {mode === "FAQ" && (
          <>
            <div>
              <Label>Question</Label>
              <Input required value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Do you offer installment payments?" />
            </div>
            <div>
              <Label>Answer</Label>
              <Textarea required rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Yes, we offer 3, 6 and 12-month plans through..." />
            </div>
          </>
        )}

        {mode === "URL" && (
          <>
            <div>
              <Label>Page title</Label>
              <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shipping information page" />
            </div>
            <div>
              <Label>URL</Label>
              <Input required type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://yourbusiness.com/shipping" />
            </div>
            <div>
              <Label>Paste the page content</Label>
              <Textarea
                required
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Automatic crawling isn't wired up in this MVP — paste the relevant text here for now (architecture supports adding a fetcher later)."
              />
            </div>
          </>
        )}

        {error && <p className="text-[12.5px] text-status-critical">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save to Knowledge Base"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

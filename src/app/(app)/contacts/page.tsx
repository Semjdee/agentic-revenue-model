"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Contact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  createdAt: string;
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Contact[]>("/api/internal/contacts").then((rows) => {
      setContacts(rows);
      setLoading(false);
    });
  }, []);

  const filtered = contacts.filter((c) => {
    const hay = `${c.name ?? ""} ${c.email ?? ""} ${c.phone ?? ""} ${c.company ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div className="pb-12">
      <PageHeader
        title="Contacts"
        description="Everyone who has ever messaged your business, across every channel."
        actions={
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" className="pl-8 w-56" />
          </div>
        }
      />
      <div className="px-5 md:px-8">
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11.5px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-black/[0.05] dark:border-white/[0.05] hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5 text-ink-primary font-medium">{c.name || "—"}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{c.phone || "—"}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{c.email || "—"}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{c.company || "—"}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && <p className="text-[13px] text-ink-muted p-6 text-center">No contacts yet.</p>}
        </div>
      </div>
    </div>
  );
}

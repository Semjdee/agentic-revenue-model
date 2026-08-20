"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { ROLES, type Role } from "@/db/schema";

interface Member {
  id: string;
  name: string;
  // Nullable — a member who signed up or was linked via phone/Google/Apple
  // may have no password-auth email (see users.email in db/schema.ts).
  email: string | null;
  role: Role;
  active: boolean;
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "SALES" as Role });
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function load() {
    setMembers(await api.get<Member[]>("/api/internal/team"));
  }
  useEffect(() => {
    load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const res = await api.post<{ temporaryPassword: string }>("/api/internal/team", form);
    setTempPassword(res.temporaryPassword);
    load();
  }

  async function changeRole(id: string, role: Role) {
    await api.patch(`/api/internal/team/${id}`, { role });
    load();
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Team"
        description="Manage who has access and what they can do."
        actions={
          <Button
            onClick={() => {
              setOpen(true);
              setTempPassword(null);
            }}
          >
            <Plus size={15} /> Invite teammate
          </Button>
        }
      />
      <div className="px-5 md:px-8">
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-ink-muted text-[11.5px] uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-black/[0.05] dark:border-white/[0.05]">
                  <td className="px-4 py-2.5 text-ink-primary font-medium">{m.name}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{m.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.id, e.target.value as Role)}
                      className="rounded-md border border-black/10 dark:border-white/15 bg-surface px-2 py-1 text-[12.5px]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={m.active ? "good" : "neutral"}>{m.active ? "Active" : "Inactive"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title="Invite teammate">
        {tempPassword ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-secondary">No email delivery configured in this MVP — share this temporary password with them directly.</p>
            <pre className="bg-black text-white text-[12px] rounded-lg p-3">{tempPassword}</pre>
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={invite} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Role</Label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-surface px-3 py-2 text-[13.5px]"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="w-full">
              Send invite
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}

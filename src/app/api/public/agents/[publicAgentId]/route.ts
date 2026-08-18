import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { jsonError, jsonOk } from "@/lib/api";

// Public, unauthenticated endpoint the embeddable widget calls on load.
// Only returns widget-safe display fields — spec section 1: "Do not expose
// secret credentials in browser code. Use only restricted public widget
// identifiers."
export async function GET(_req: Request, { params }: { params: { publicAgentId: string } }) {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.publicAgentId, params.publicAgentId)).limit(1);
  if (!agent || agent.status !== "ACTIVE") return jsonError("Agent not found", 404);

  return jsonOk({
    publicAgentId: agent.publicAgentId,
    name: agent.name,
    avatarUrl: agent.avatarUrl,
    company: agent.company,
    greeting: agent.greeting,
    widgetColor: agent.widgetColor,
    launcherPosition: agent.launcherPosition,
  });
}

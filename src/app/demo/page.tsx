"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Public, unauthenticated demo host page. Simulates "a business's website"
// with the embeddable widget installed exactly as a real customer would
// install it — this is what spec section 38 calls the independent
// Website -> Widget -> AI Sales Agent -> Back-office Inbox demonstration.
function DemoContent() {
  const params = useSearchParams();
  const agentId = params.get("agent");

  useEffect(() => {
    if (!agentId) return;
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.setAttribute("data-agent", agentId);
    script.async = true;
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
      document.getElementById("ai-revenue-agent-widget-host")?.remove();
    };
  }, [agentId]);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-lg">☀️ RayGrid Solar Energy</span>
        <nav className="hidden sm:flex gap-6 text-sm text-neutral-600">
          <span>Products</span>
          <span>Financing</span>
          <span>About</span>
          <span>Contact</span>
        </nav>
      </header>
      <section className="px-6 py-20 max-w-3xl mx-auto text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Reliable solar power for your home or business</h1>
        <p className="mt-4 text-neutral-600">This is a demo storefront with the AI Revenue Agent widget installed exactly as it would be on a real customer website — click the chat bubble in the corner to talk to the AI Sales Agent.</p>
      </section>
      {!agentId && (
        <div className="max-w-md mx-auto text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-4">
          Add <code>?agent=YOUR_PUBLIC_AGENT_ID</code> to this URL — find it under AI Agents → your agent → Widget &amp; Embed.
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense>
      <DemoContent />
    </Suspense>
  );
}

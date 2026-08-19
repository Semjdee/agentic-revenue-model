import type { AIProvider } from "./types";
import { MockAIProvider } from "./mock-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { DEFAULT_MODEL } from "@/modules/billing/pricing";

export * from "./types";

let cached: AIProvider | null = null;

/**
 * AIProvider factory (spec section 25: "Do not deeply couple the
 * application to one model provider. Allow future providers/models.").
 *
 * Resolution order:
 *  1. ANTHROPIC_API_KEY set        -> AnthropicProvider (real LLM)
 *  2. otherwise                    -> MockAIProvider (rule-based, offline)
 *
 * Adding OpenAI or another provider later is a matter of adding a new
 * `*-provider.ts` file implementing AIProvider and one more branch here.
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    cached = new AnthropicProvider(anthropicKey, process.env.ANTHROPIC_MODEL || DEFAULT_MODEL);
  } else {
    cached = new MockAIProvider();
  }
  return cached;
}

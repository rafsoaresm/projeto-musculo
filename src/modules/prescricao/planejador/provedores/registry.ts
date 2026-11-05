import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import type { PlannerProvider, ProviderKind } from "./port";

const ADAPTERS: Readonly<Record<ProviderKind, PlannerProvider>> = Object.freeze({
  mock: mockProvider, openai: openaiProvider, anthropic: anthropicProvider, google: googleProvider,
});

/** The adapter for a kind. `mock` is only usable when the caller checked `AI_MOCK_ENABLED` (the gate does). */
export const providerFor = (kind: ProviderKind): PlannerProvider => ADAPTERS[kind];

export const PROVIDER_LABEL: Readonly<Record<ProviderKind, string>> = Object.freeze({
  mock: "Simulado (testes)", openai: "OpenAI", anthropic: "Anthropic", google: "Google (Gemini)",
});

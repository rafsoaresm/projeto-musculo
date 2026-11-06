/** Names of the providers as the interface shows them (no adapter code, so client components may import it). */
import type { ProviderKind } from "./port";

export const PROVIDER_LABEL: Readonly<Record<ProviderKind, string>> = Object.freeze({
  mock: "Simulado (testes)", openai: "OpenAI", anthropic: "Anthropic", google: "Google (Gemini)",
});

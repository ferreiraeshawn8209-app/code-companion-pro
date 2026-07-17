/**
 * AI provider registry.
 *
 * Phase 1: Lovable AI Gateway is the only enabled provider (no user API key needed).
 * Later phases can register OpenAI, Anthropic, Gemini (direct), DeepSeek, and Ollama
 * by adding entries here and implementing corresponding server-side factories.
 */

export type AIProviderId =
  | "lovable"
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "ollama";

export interface AIProviderModel {
  id: string;
  label: string;
  description?: string;
}

export interface AIProviderDefinition {
  id: AIProviderId;
  label: string;
  description: string;
  enabled: boolean;
  requiresApiKey: boolean;
  models: AIProviderModel[];
}

export const AI_PROVIDERS: AIProviderDefinition[] = [
  {
    id: "lovable",
    label: "Lovable AI",
    description: "Managed multi-model gateway. No API key required.",
    enabled: true,
    requiresApiKey: false,
    models: [
      { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", description: "Fast, strong at code" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Large-context reasoning" },
      { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", description: "Balanced OpenAI reasoning" },
      { id: "openai/gpt-5.5", label: "GPT-5.5", description: "Top-tier coding" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI (BYO key)",
    description: "Bring your own OpenAI API key. Coming soon.",
    enabled: false,
    requiresApiKey: true,
    models: [],
  },
  {
    id: "anthropic",
    label: "Anthropic (BYO key)",
    description: "Claude models with your Anthropic key. Coming soon.",
    enabled: false,
    requiresApiKey: true,
    models: [],
  },
  {
    id: "gemini",
    label: "Google Gemini (BYO key)",
    description: "Direct Gemini API with your Google key. Coming soon.",
    enabled: false,
    requiresApiKey: true,
    models: [],
  },
  {
    id: "deepseek",
    label: "DeepSeek (BYO key)",
    description: "DeepSeek Coder / Chat. Coming soon.",
    enabled: false,
    requiresApiKey: true,
    models: [],
  },
  {
    id: "ollama",
    label: "Local (Ollama)",
    description: "Run Llama / Qwen locally. Coming soon.",
    enabled: false,
    requiresApiKey: false,
    models: [],
  },
];

export function getProvider(id: AIProviderId): AIProviderDefinition | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}

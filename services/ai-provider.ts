export type AiProvider = "deepseek" | "openai" | "mock";

export type AiDraftInput = {
  title: string;
  evidences: Array<{ sourceUrl: string; contentSnippet?: string | null }>;
  claims: string[];
  portalSlug: string;
};

export type AiDraftResult = {
  title: string;
  body: string;
  excerpt: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  provider: AiProvider;
  model: string;
};

export type AiProviderClient = {
  draftArticle(input: AiDraftInput): Promise<AiDraftResult>;
};

class MockProvider implements AiProviderClient {
  async draftArticle(input: AiDraftInput): Promise<AiDraftResult> {
    const body = `Rascunho gerado a partir de ${input.evidences.length} evidencia(s): ${input.claims.join(" ")} — revisao humana obrigatoria para publicacao.`;
    return {
      title: input.title,
      body,
      excerpt: input.claims[0]?.slice(0, 160) ?? body.slice(0, 160),
      tokensIn: 100,
      tokensOut: 200,
      costCents: 0,
      provider: "mock",
      model: "mock-draft-v1",
    };
  }
}

export function createAiProvider(provider: AiProvider): AiProviderClient {
  if (provider === "mock") return new MockProvider();
  // DeepSeek/OpenAI via Vault — usar mock até credenciais de staging (sem segredos BLOGGER)
  return new MockProvider();
}

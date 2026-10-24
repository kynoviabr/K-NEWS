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

// Sem credenciais: nao escreve texto jornalistico. Gera apenas uma pauta curta com a
// atribuicao da fonte, que o editor precisa reescrever antes de publicar (a guarda
// do banco exige texto minimo de 200 caracteres).
class MockProvider implements AiProviderClient {
  async draftArticle(input: AiDraftInput): Promise<AiDraftResult> {
    // Sem contagens no texto: qualquer numero ausente da fonte seria marcado como afirmacao sem respaldo.
    const body = `[Rascunho sem IA — reescrever antes de publicar] ${input.claims.join(" ")}`;
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

const SYSTEM_PROMPT = [
  "Voce e redator de um portal de noticias local brasileiro.",
  "Escreva uma nota jornalistica ORIGINAL em portugues do Brasil usando SOMENTE os fatos do material de origem.",
  "Nao invente fatos, numeros, nomes, datas, falas ou citacoes. Nao use aspas para falas que nao estejam literalmente no material.",
  "Nao copie frases da fonte; reescreva. Atribua as informacoes a fonte (ex.: 'segundo ...').",
  "Se o material for insuficiente, escreva apenas o que ele sustenta, mesmo que curto.",
  'Responda apenas JSON: {"title": string, "excerpt": string (ate 160 caracteres), "body": string}.',
].join(" ");

type ChatConfig = { provider: "deepseek" | "openai"; apiKey: string; baseUrl: string; model: string; centsPerMTokIn: number; centsPerMTokOut: number };

export class OpenAiCompatibleProvider implements AiProviderClient {
  constructor(private readonly cfg: ChatConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async draftArticle(input: AiDraftInput): Promise<AiDraftResult> {
    const material = input.evidences
      .map((e, i) => `Fonte ${i + 1} (${e.sourceUrl}):\n${(e.contentSnippet ?? "").slice(0, 4000)}`)
      .join("\n\n");
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Portal: ${input.portalSlug}\nTitulo de origem: ${input.title}\n\n${material}` },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${this.cfg.provider} HTTP ${res.status}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: { title?: unknown; excerpt?: unknown; body?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`${this.cfg.provider}: resposta nao e JSON`);
    }
    if (typeof parsed.title !== "string" || typeof parsed.body !== "string") throw new Error(`${this.cfg.provider}: JSON sem title/body`);
    const tokensIn = json.usage?.prompt_tokens ?? 0;
    const tokensOut = json.usage?.completion_tokens ?? 0;
    return {
      title: parsed.title.trim().slice(0, 200),
      body: parsed.body.trim(),
      excerpt: (typeof parsed.excerpt === "string" ? parsed.excerpt : parsed.body).trim().slice(0, 160),
      tokensIn,
      tokensOut,
      costCents: Math.ceil((tokensIn * this.cfg.centsPerMTokIn + tokensOut * this.cfg.centsPerMTokOut) / 1_000_000),
      provider: this.cfg.provider,
      model: this.cfg.model,
    };
  }
}

export function createAiProvider(provider: AiProvider, env: Record<string, string | undefined> = process.env): AiProviderClient {
  if (provider === "deepseek" && env.DEEPSEEK_API_KEY) {
    return new OpenAiCompatibleProvider({
      provider,
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
      centsPerMTokIn: Number(env.DEEPSEEK_CENTS_PER_MTOK_IN ?? 0),
      centsPerMTokOut: Number(env.DEEPSEEK_CENTS_PER_MTOK_OUT ?? 0),
    });
  }
  if (provider === "openai" && env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider({
      provider,
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
      centsPerMTokIn: Number(env.OPENAI_CENTS_PER_MTOK_IN ?? 0),
      centsPerMTokOut: Number(env.OPENAI_CENTS_PER_MTOK_OUT ?? 0),
    });
  }
  return new MockProvider();
}

// DeepSeek preferido, OpenAI como alternativa; sem chave, provedor sem IA.
export function createAiProviderFromEnv(env: Record<string, string | undefined> = process.env): AiProviderClient {
  const preferred = (env.KNEWS_AI_PROVIDER as AiProvider | undefined) ?? (env.DEEPSEEK_API_KEY ? "deepseek" : env.OPENAI_API_KEY ? "openai" : "mock");
  return createAiProvider(preferred, env);
}

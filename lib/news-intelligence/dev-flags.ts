// Feeds em 127.0.0.1 so para demonstracao local: exige a flag E o Supabase local.
// Em qualquer outro ambiente a protecao SSRF continua integral.
export function allowPrivateFeeds(env: Record<string, string | undefined> = process.env): boolean {
  if (env.KNEWS_ALLOW_PRIVATE_FEEDS !== "1") return false;
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

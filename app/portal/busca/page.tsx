import type { Metadata } from "next";
import { ArticleList, pageFrom } from "@/components/portal/article-list";
import { getSections, resolveRequestPortal, searchArticles } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Resultados de busca nao sao indexados (conteudo duplicado e consultas arbitrarias).
export const metadata: Metadata = { title: "Busca", robots: { index: false, follow: true } };

export default async function BuscaPage({ searchParams }: Props) {
  const portal = await resolveRequestPortal();
  if (!portal) return null;
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) ?? "";
  const page = pageFrom(sp.pagina);
  const sections = await getSections(portal.id);
  const result = q.length >= 2 ? await searchArticles(portal.id, { query: q, page }) : { total: 0, items: [] };
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 lg:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight">Busca</h1>
      {q.length < 2 ? (
        <p className="text-sm text-muted-foreground">Digite ao menos 2 letras no campo de busca.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {result.total} resultado{result.total === 1 ? "" : "s"} para “{q}” em {portal.name}
          </p>
          <ArticleList items={result.items} total={result.total} page={page} sections={sections} baseHref={`/portal/busca?q=${encodeURIComponent(q)}`} empty="Nada encontrado. Tente outras palavras." />
        </>
      )}
    </main>
  );
}

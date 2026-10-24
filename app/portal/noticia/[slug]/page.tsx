import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AdSlot } from "@/components/advertising/ad-slot";
import { newsArticleJsonLd } from "@/lib/seo";
import { canonicalUrl } from "@/lib/portal";
import { getPublished, resolveRequestPortal } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const portal = await resolveRequestPortal();
  if (!portal) return null;
  const article = await getPublished(portal.id, slug);
  return article ? { portal, article } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) return { title: "Matéria não encontrada" };
  const url = canonicalUrl(`/portal/noticia/${slug}`, found.portal.slug);
  return {
    title: `${found.article.title} — ${found.portal.name}`,
    description: found.article.excerpt ?? undefined,
    alternates: { canonical: url },
    openGraph: { type: "article", title: found.article.title, description: found.article.excerpt ?? undefined, url, publishedTime: found.article.published_at },
  };
}

export default async function NoticiaPage({ params }: Params) {
  const { slug } = await params;
  const found = await load(slug);
  if (!found) notFound();
  const { portal, article } = found;
  const url = canonicalUrl(`/portal/noticia/${slug}`, portal.slug);
  const jsonLd = newsArticleJsonLd({
    headline: article.title,
    description: article.excerpt ?? undefined,
    datePublished: article.published_at,
    dateModified: article.updated_at,
    url,
    publisherName: portal.name,
  });

  return (
    <article className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Link href="/portal" className="text-sm text-primary hover:underline">← {portal.name}</Link>
      <header className="space-y-2">
        {article.category && <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--knews-primary))]">{article.category}</p>}
        <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight">{article.title}</h1>
        {article.excerpt && <p className="text-lg text-muted-foreground">{article.excerpt}</p>}
        <p className="text-sm text-muted-foreground">
          Publicado em <time dateTime={article.published_at}>{new Date(article.published_at).toLocaleString("pt-BR")}</time>
        </p>
      </header>

      <AdSlot portalId={portal.id} slotCode="artigo-topo" category={article.category} neighborhood={article.neighborhood} />

      <div className="space-y-4 whitespace-pre-line text-base leading-relaxed">{article.body}</div>

      <AdSlot portalId={portal.id} slotCode="artigo-rodape" category={article.category} neighborhood={article.neighborhood} />

      <section className="rounded-lg border p-4" aria-labelledby="fontes">
        <h2 id="fontes" className="font-heading text-lg font-semibold">Fontes</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {article.evidences.map((e) => (
            <li key={e.url}>
              <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{e.label ?? e.url}</a>
              <span className="text-muted-foreground"> · consultada em {new Date(e.captured_at).toLocaleDateString("pt-BR")}</span>
            </li>
          ))}
        </ul>
      </section>

      {article.corrections.length > 0 && (
        <section className="rounded-lg border border-amber-300 p-4" aria-labelledby="correcoes">
          <h2 id="correcoes" className="font-heading text-lg font-semibold">Correções</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {article.corrections.map((c) => (
              <li key={c.at}>{new Date(c.at).toLocaleDateString("pt-BR")}: {c.note}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

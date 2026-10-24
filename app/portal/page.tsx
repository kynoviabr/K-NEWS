import type { Metadata } from "next";
import { ArticleCard } from "@/components/news/article-card";
import { AdSlot } from "@/components/advertising/ad-slot";
import { canonicalUrl } from "@/lib/portal";
import { listPublished, resolveRequestPortal } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const portal = await resolveRequestPortal();
  if (!portal) return { title: "Portal 24h" };
  return {
    title: portal.name,
    description: `Notícias de ${portal.city ?? portal.name} com fontes e correções públicas.`,
    alternates: { canonical: canonicalUrl("/portal", portal.slug) },
  };
}

export default async function PortalPage() {
  const portal = await resolveRequestPortal();
  if (!portal) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="font-heading text-2xl font-bold">Portal 24h</h1>
        <p className="mt-2 text-sm text-muted-foreground">Nenhum portal configurado para este endereço.</p>
      </div>
    );
  }
  const articles = await listPublished(portal.id, 30);
  const [lead, ...rest] = articles;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6 lg:p-8">
      <header className="border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--knews-primary))]">Portal 24h</p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">{portal.city ?? portal.name}</h1>
      </header>

      <AdSlot portalId={portal.id} slotCode="portal-topo" />

      {!lead && <p className="text-sm text-muted-foreground">Ainda não há matérias publicadas.</p>}
      {lead && (
        <section aria-label="Manchete">
          <ArticleCard slug={lead.slug} title={lead.title} excerpt={lead.excerpt} category={lead.category} publishedAt={lead.published_at} hrefPrefix="/portal/noticia" />
        </section>
      )}
      <AdSlot portalId={portal.id} slotCode="portal-meio" />
      {rest.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Últimas notícias">
          {rest.map((a) => (
            <ArticleCard key={a.slug} slug={a.slug} title={a.title} excerpt={a.excerpt} category={a.category} publishedAt={a.published_at} hrefPrefix="/portal/noticia" />
          ))}
        </section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Toda matéria publicada passou por revisão humana e mostra suas fontes e correções.
      </footer>
    </div>
  );
}

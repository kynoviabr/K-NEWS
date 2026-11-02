import type { Metadata } from "next";
import { ArticleCard } from "@/components/news/article-card";
import { AdSlot } from "@/components/advertising/ad-slot";
import { ArticleList, pageFrom } from "@/components/portal/article-list";
import { portalUrl } from "@/lib/portal";
import { getSections, resolveRequestPortal, searchArticles } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const portal = await resolveRequestPortal();
  if (!portal) return { title: "Portal 24h" };
  const seo = portal.seo as { description?: string };
  return {
    title: portal.name,
    description: seo.description ?? `Notícias de ${portal.city ?? portal.name} com fontes e correções públicas.`,
    alternates: { canonical: portalUrl(portal, "/portal") },
  };
}

export default async function PortalPage({ searchParams }: Props) {
  const portal = await resolveRequestPortal();
  if (!portal) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="font-heading text-2xl font-bold">Portal 24h</h1>
        <p className="mt-2 text-sm text-muted-foreground">Nenhum portal configurado para este endereço.</p>
      </div>
    );
  }
  const page = pageFrom((await searchParams).pagina);
  const [sections, latest] = await Promise.all([getSections(portal.id), searchArticles(portal.id, { page })]);
  const names = new Map(sections.categories.map((c) => [c.slug, c.name]));
  const [lead, ...rest] = page === 1 ? latest.items : [undefined, ...latest.items];

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-6 lg:p-8">
      <h1 className="sr-only">{portal.name}: últimas notícias de {portal.city}</h1>
      <AdSlot portalId={portal.id} slotCode="portal-topo" />

      {latest.total === 0 && <p className="text-sm text-muted-foreground">Ainda não há matérias publicadas.</p>}
      {lead && (
        <section aria-label="Manchete">
          <ArticleCard slug={lead.slug} title={lead.title} excerpt={lead.excerpt} category={lead.category ? names.get(lead.category) ?? lead.category : null} publishedAt={lead.published_at} hrefPrefix="/portal/noticia" />
        </section>
      )}
      <AdSlot portalId={portal.id} slotCode="portal-meio" />
      {rest.length > 0 && (
        <section aria-label="Últimas notícias">
          <ArticleList items={rest.filter((a) => a !== undefined)} total={latest.total} page={page} sections={sections} baseHref="/portal" empty="" />
        </section>
      )}
    </main>
  );
}

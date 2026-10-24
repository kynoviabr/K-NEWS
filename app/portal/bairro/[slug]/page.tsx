import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleList, pageFrom } from "@/components/portal/article-list";
import { portalUrl } from "@/lib/portal";
import { getSections, resolveRequestPortal, searchArticles } from "@/lib/portal-data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(slug: string) {
  const portal = await resolveRequestPortal();
  if (!portal) return null;
  const sections = await getSections(portal.id);
  const area = sections.neighborhoods.find((c) => c.slug === slug);
  return area ? { portal, sections, area } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load((await params).slug);
  if (!found) return { title: "Bairro não encontrado" };
  return {
    title: `${found.area.name}, ${found.portal.city} — ${found.portal.name}`,
    description: `Notícias do bairro ${found.area.name}, em ${found.portal.city}.`,
    alternates: { canonical: portalUrl(found.portal, `/portal/bairro/${found.area.slug}`) },
  };
}

export default async function BairroPage({ params, searchParams }: Props) {
  const found = await load((await params).slug);
  if (!found) notFound();
  const page = pageFrom((await searchParams).pagina);
  const result = await searchArticles(found.portal.id, { neighborhood: found.area.slug, page });
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 lg:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight">{found.area.name}</h1>
      <ArticleList items={result.items} total={result.total} page={page} sections={found.sections} baseHref={`/portal/bairro/${found.area.slug}`} empty="Nenhuma matéria publicada sobre este bairro." />
    </main>
  );
}

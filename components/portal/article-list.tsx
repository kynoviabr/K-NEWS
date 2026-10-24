import Link from "next/link";
import { ArticleCard } from "@/components/news/article-card";
import { PAGE_SIZE, type PortalSections, type SearchItem } from "@/lib/portal-data";

type Props = {
  items: SearchItem[];
  total: number;
  page: number;
  sections: PortalSections;
  baseHref: string; // ex.: /portal/editoria/saude ou /portal/busca?q=praia
  empty: string;
};

// Grade de materias com paginacao por link (rastreavel, sem JS).
export function ArticleList({ items, total, page, sections, baseHref, empty }: Props) {
  const names = new Map(sections.categories.map((c) => [c.slug, c.name]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}pagina=${p}`;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <ArticleCard
            key={a.slug}
            slug={a.slug}
            title={a.title}
            excerpt={a.excerpt}
            category={a.category ? names.get(a.category) ?? a.category : null}
            publishedAt={a.published_at}
            hrefPrefix="/portal/noticia"
          />
        ))}
      </div>
      {pages > 1 && (
        <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href(page - 1)} rel="prev" className="text-primary hover:underline">← Mais recentes</Link> : <span />}
          <span className="text-muted-foreground">Página {page} de {pages}</span>
          {page < pages ? <Link href={href(page + 1)} rel="next" className="text-primary hover:underline">Mais antigas →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}

export function pageFrom(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : 1;
}

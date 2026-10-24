import Link from "next/link";
import { ConsentBanner } from "@/components/advertising/consent-banner";
import { getSections, resolveRequestPortal } from "@/lib/portal-data";
import { themeCssVars } from "@/lib/theme";

// Moldura do portal por hostname: identidade visual da cidade, editorias e busca.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const portal = await resolveRequestPortal();
  if (!portal) {
    return (
      <>
        {children}
        <ConsentBanner />
      </>
    );
  }
  const sections = await getSections(portal.id);
  const theme = portal.theme as { tagline?: string; logo_text?: string };
  const categories = sections.categories.filter((c) => c.count > 0);

  return (
    <div style={themeCssVars(portal.theme) as React.CSSProperties} className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <Link href="/portal" className="font-heading text-2xl font-bold tracking-tight text-[hsl(var(--knews-primary))]">
              {theme.logo_text || portal.name}
            </Link>
            {theme.tagline && <p className="text-sm text-muted-foreground">{theme.tagline}</p>}
          </div>
          <form action="/portal/busca" method="get" role="search" className="flex gap-2">
            <label htmlFor="portal-q" className="sr-only">Buscar notícias</label>
            <input
              id="portal-q"
              name="q"
              type="search"
              minLength={2}
              maxLength={100}
              placeholder={`Buscar em ${portal.city ?? portal.name}`}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm md:w-64"
            />
            <button type="submit" className="h-9 rounded-md bg-[hsl(var(--knews-primary))] px-3 text-sm font-medium text-white">Buscar</button>
          </form>
        </div>
        {categories.length > 0 && (
          <nav aria-label="Editorias" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-3 md:px-6">
            <ul className="flex gap-4 whitespace-nowrap text-sm font-medium">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link href={`/portal/editoria/${c.slug}`} className="hover:text-[hsl(var(--knews-primary))] hover:underline">{c.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      {children}
      <footer className="mx-auto max-w-6xl border-t px-4 py-6 text-xs text-muted-foreground md:px-6">
        <p>{portal.name} · Toda matéria publicada passou por revisão humana e mostra suas fontes e correções.</p>
        {sections.neighborhoods.some((n) => n.count > 0) && (
          <p className="mt-2">
            Bairros:{" "}
            {sections.neighborhoods
              .filter((n) => n.count > 0)
              .map((n, i) => (
                <span key={n.slug}>
                  {i > 0 && " · "}
                  <Link href={`/portal/bairro/${n.slug}`} className="hover:underline">{n.name}</Link>
                </span>
              ))}
          </p>
        )}
      </footer>
      <ConsentBanner />
    </div>
  );
}

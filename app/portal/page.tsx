import { headers } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArticleCard } from "@/components/news/article-card";
import { AdSlot } from "@/components/advertising/ad-slot";
import { extractCitySlugFromHost, PRIMARY_DOMAIN } from "@/lib/domains";
import { canonicalUrl } from "@/lib/portal";

export default async function PortalPage() {
  const h = await headers();
  const host = h.get("host") ?? h.get("x-knews-host");
  const citySlug = h.get("x-knews-city") ?? extractCitySlugFromHost(host);
  const title = citySlug ? `K-NEWS — ${citySlug[0]!.toUpperCase()}${citySlug.slice(1)}` : "K-NEWS — Rede Portal24h";
  const canonical = canonicalUrl("/portal", citySlug);

  const DEMO_ARTICLES = [
    { slug: "guaruja-inaugura-nova-unidade-saude", title: "Guaruja inaugura nova unidade de saude no Pereque", excerpt: "Equipamento amplia atendimento na regiao com foco em atencao basica.", category: "Cidade", publishedAt: new Date().toISOString() },
    { slug: "litoral-norte-tem-alerta-ressaca", title: "Litoral Norte tem alerta de ressaca ate quinta", excerpt: "Defesa Civil recomenda atencao a navegacao e orla.", category: "Regiao", publishedAt: new Date().toISOString() },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6 lg:p-8">
      <header className="space-y-2">
        <Badge className="bg-[hsl(var(--knews-primary))] text-white">{citySlug ?? PRIMARY_DOMAIN}</Badge>
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">Cobertura hiperlocal com evidencias, SEO e transparencia editorial. {canonical}</p>
      </header>

      <AdSlot slotId="portal-topo" fallbackLabel="Anuncio — topo do portal" />

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {DEMO_ARTICLES.map((a) => (
          <ArticleCard key={a.slug} {...a} hrefPrefix="/portal/noticia" />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Transparencia editorial</CardTitle>
          <CardDescription>Toda materia publicada exibe fontes, data e historico de correcao.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Conteudo demo — por cidade via knews.portals e subdominio *.portal24h.news.</p>
        </CardContent>
      </Card>
    </div>
  );
}

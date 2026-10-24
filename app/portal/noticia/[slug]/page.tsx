import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdSlot } from "@/components/advertising/ad-slot";
import { newsArticleJsonLd } from "@/lib/seo";
import { canonicalUrl } from "@/lib/portal";
import { extractCitySlugFromHost } from "@/lib/domains";

const DEMO: Record<string, { title: string; excerpt: string; body: string; category: string; publishedAt: string }> = {
  "guaruja-inaugura-nova-unidade-saude": {
    title: "Guaruja inaugura nova unidade de saude no Pereque",
    excerpt: "Equipamento amplia atendimento na regiao com foco em atencao basica.",
    body: "Conteudo demo — a materia real exibira evidencias rastreaveis, fontes oficiais e historico de atualizacao. Nenhum fato e inventado.",
    category: "Cidade",
    publishedAt: new Date().toISOString(),
  },
  "litoral-norte-tem-alerta-ressaca": {
    title: "Litoral Norte tem alerta de ressaca ate quinta",
    excerpt: "Defesa Civil recomenda atencao a navegacao e orla.",
    body: "Conteudo demo — fontes oficiais e evidencias serao exibidas por artigo na Fase 3.",
    category: "Regiao",
    publishedAt: new Date().toISOString(),
  },
};

export default async function NoticiaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = DEMO[slug];
  if (!article) return notFound();
  const h = await headers();
  const citySlug = h.get("x-knews-city") ?? extractCitySlugFromHost(h.get("host"));
  const url = canonicalUrl(`/portal/noticia/${slug}`, citySlug);
  const jsonLd = newsArticleJsonLd({
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    url,
    publisherName: "K-NEWS",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="space-y-2">
        <Badge>{article.category}</Badge>
        <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight">{article.title}</h1>
        <p className="text-sm text-muted-foreground">{new Date(article.publishedAt).toLocaleDateString("pt-BR")} • {url}</p>
      </div>
      <AdSlot slotId="in-article-top" fallbackLabel="Anuncio — dentro da materia" className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed bg-muted/50 px-4 py-8 text-center" />
      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
          <CardDescription>{article.excerpt}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{article.body}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Evidencias</CardTitle>
          <CardDescription>Fontes e documentos consultados</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Prefeitura de Guaruja — comunicado oficial (demo)</li>
            <li>Diario Oficial — edicao do dia (demo)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

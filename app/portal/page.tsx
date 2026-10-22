import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArticleCard } from "@/components/news/article-card";
import { AdSlot } from "@/components/advertising/ad-slot";

const DEMO_ARTICLES = [
  { slug: "guaruja-inaugura-nova-unidade-saude", title: "Guaruja inaugura nova unidade de saude no Pereque", excerpt: "Equipamento amplia atendimento na regiao com foco em atencao basica.", category: "Cidade", publishedAt: new Date().toISOString() },
  { slug: "litoral-norte-tem-alerta-ressaca", title: "Litoral Norte tem alerta de ressaca ate quinta", excerpt: "Defesa Civil recomenda atencao a navegacao e orla.", category: "Regiao", publishedAt: new Date().toISOString() },
];

export default function PortalPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6 lg:p-8">
      <header className="space-y-2">
        <Badge className="bg-[hsl(var(--knews-primary))] text-white">Portal Publico — Demo Fase 2</Badge>
        <h1 className="font-heading text-3xl font-bold tracking-tight">K-NEWS — Guaruja e Regiao</h1>
        <p className="text-sm text-muted-foreground">Cobertura hiperlocal com evidencias, SEO e transparencia editorial.</p>
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
          <p className="text-sm text-muted-foreground">Conteudo demo — dados reais por portal e localidade na Fase 2 completa.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cidades</CardTitle>
            <CardDescription>Portais por cidade e bairro</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Piloto: Guaruja/SP · Expansao: Santos, Baixada Santista, Litoral Norte/Sul.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Publicidade</CardTitle>
            <CardDescription>Slots dinamicos — sem editar HTML do artigo</CardDescription>
          </CardHeader>
          <CardContent>
            <AdSlot slotId="portal-sidebar" fallbackLabel="Anuncio — lateral" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { afterEach, describe, expect, it } from "vitest";
import { isIndexablePath, isPanelHost, isRootPath, portalBasePath } from "@/lib/hosts";

afterEach(() => {
  delete process.env.KNEWS_PANEL_HOSTS;
});

describe("painel x portal por host", () => {
  it("localhost, previews da Vercel e KNEWS_PANEL_HOSTS sao painel", () => {
    process.env.KNEWS_PANEL_HOSTS = "painel.portal24h.news, Admin.Example.com";
    for (const h of ["localhost:3000", "127.0.0.1", "k-news-git-x.vercel.app", "painel.portal24h.news", "admin.example.com:443", null]) {
      expect(isPanelHost(h), String(h)).toBe(true);
    }
    for (const h of ["guaruja.portal24h.news", "guaruja.localhost:3100", "portal24h.news", "noticiasdoguaruja.com.br"]) {
      expect(isPanelHost(h), h).toBe(false);
    }
  });

  it("prefixo dos links: raiz no portal, /portal na previa", () => {
    expect(portalBasePath("guaruja.portal24h.news")).toBe("");
    expect(portalBasePath("localhost:3000")).toBe("/portal");
  });

  it("APIs e arquivos publicos ficam na raiz; o resto do portal vai para /portal", () => {
    for (const p of ["/api/ads/click/x", "/r/oferta", "/sitemap.xml", "/robots.txt", "/ads.txt", "/opengraph-image", "/_next/data/x.json"]) expect(isRootPath(p), p).toBe(true);
    for (const p of ["/", "/noticia/x", "/busca", "/login", "/apix", "/sitemap.xml.bak"]) expect(isRootPath(p), p).toBe(false);
  });

  it("indexacao: portal e arquivos publicos sim; painel, APIs e redirecionamentos nao", () => {
    expect(isIndexablePath("/noticia/x", true)).toBe(true);
    expect(isIndexablePath("/api/ads/click/x", true)).toBe(false);
    expect(isIndexablePath("/r/oferta", true)).toBe(false);
    expect(isIndexablePath("/noticias", false)).toBe(false);
    expect(isIndexablePath("/portal/noticia/x", false)).toBe(true);
    expect(isIndexablePath("/sitemap.xml", false)).toBe(true);
  });
});

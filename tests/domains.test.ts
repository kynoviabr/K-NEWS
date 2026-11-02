import { describe, it, expect } from "vitest";
import { extractCitySlugFromHost, buildPortalHost, isPortal24hHost, PRIMARY_DOMAIN } from "@/lib/domains";
import { resolvePortalFromHost, canonicalUrl } from "@/lib/portal";

describe("domains", () => {
  it("resolve subdominio por host", () => {
    expect(extractCitySlugFromHost("guaruja.portal24h.news")).toBe("guaruja");
    expect(extractCitySlugFromHost("santos.portal24h.news:3000")).toBe("santos");
    expect(extractCitySlugFromHost("portal24h.news")).toBeNull();
    expect(extractCitySlugFromHost("www.portal24h.news")).toBeNull();
    expect(extractCitySlugFromHost("evil.com")).toBeNull();
    expect(extractCitySlugFromHost("a.b.portal24h.news")).toBeNull();
  });

  it("builda host canonico", () => {
    expect(buildPortalHost("guaruja")).toBe("guaruja.portal24h.news");
  });

  it("detecta host portal24h", () => {
    expect(isPortal24hHost("guaruja.portal24h.news")).toBe(true);
    expect(isPortal24hHost("portal24h.news")).toBe(true);
    expect(isPortal24hHost("example.com")).toBe(false);
  });

  it("resolvePortalFromHost com mapa e fallback subdominio", () => {
    const domains = { "custom.example.com": "portal-1" };
    expect(resolvePortalFromHost("guaruja.portal24h.news", {}).citySlug).toBe("guaruja");
    expect(resolvePortalFromHost("custom.example.com", domains).portalId).toBe("portal-1");
    expect(resolvePortalFromHost("evil.com", {}).portalId).toBeNull();
  });

  it("canonical por cidade", () => {
    expect(canonicalUrl("/portal", "guaruja")).toBe("https://guaruja.portal24h.news/portal");
    expect(canonicalUrl("/portal/noticia/x", null)).toContain(PRIMARY_DOMAIN);
  });

  it("isolamento entre cidades: hosts diferentes nao colidem", () => {
    const a = extractCitySlugFromHost("guaruja.portal24h.news");
    const b = extractCitySlugFromHost("santos.portal24h.news");
    expect(a).not.toBe(b);
  });
});

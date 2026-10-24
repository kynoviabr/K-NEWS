import { expect, test } from "@playwright/test";
import { E2E, portalUrl } from "./data";
import { declineConsent, hostFetch } from "./helpers";

// Leitor no portal da cidade, por hostname. Roda em desktop e em celular.

test("home de Guaruja com identidade e menu da cidade", async ({ page }) => {
  await page.goto(portalUrl(E2E.hosts.guaruja, "/portal"));
  await declineConsent(page);
  await expect(page.locator("header")).toContainText("Guarujá");
  await expect(page.getByRole("link", { name: E2E.articles.guaruja.title })).toBeVisible();
  await expect(page.getByRole("link", { name: E2E.articles.santos.title })).toHaveCount(0);
});

test("busca fica no portal da cidade", async ({ page }) => {
  await page.goto(portalUrl(E2E.hosts.guaruja, "/portal/busca?q=feira%20artesanato"));
  await expect(page.getByRole("link", { name: E2E.articles.guaruja.title })).toBeVisible();
  await expect(page.getByRole("link", { name: E2E.articles.santos.title })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.goto(portalUrl(E2E.hosts.santos, "/portal/busca?q=feira%20artesanato"));
  await expect(page.getByRole("link", { name: E2E.articles.santos.title })).toBeVisible();
  await expect(page.getByRole("link", { name: E2E.articles.guaruja.title })).toHaveCount(0);
});

test("materia: canonical, dados estruturados, bairro e anuncio identificado", async ({ page }) => {
  await page.goto(portalUrl(E2E.hosts.guaruja, `/portal/noticia/${E2E.articles.guaruja.slug}`));
  await declineConsent(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(E2E.articles.guaruja.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://guaruja.portal24h.news/portal/noticia/${E2E.articles.guaruja.slug}`);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
  expect(ld["@type"]).toBe("NewsArticle");
  await expect(page.getByRole("link", { name: "Perequê" }).first()).toBeVisible();
  const ad = page.locator("aside", { hasText: E2E.adHeadline });
  await expect(ad).toBeVisible();
  await expect(ad).toContainText("Publicidade");
  const href = await ad.locator("a").first().getAttribute("href");
  expect(href).toMatch(/^\/api\/ads\/click\//);
  const click = await hostFetch(page, E2E.hosts.guaruja, href!);
  expect(click.status()).toBe(302);
  expect(click.headers().location).toBe(E2E.adUrl);
});

test("anuncio e materias de Guaruja nao vazam para Santos", async ({ page }) => {
  await page.goto(portalUrl(E2E.hosts.santos, `/portal/noticia/${E2E.articles.santos.slug}`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(E2E.articles.santos.title);
  await expect(page.getByText(E2E.adHeadline)).toHaveCount(0);
  expect((await hostFetch(page, E2E.hosts.santos, `/portal/noticia/${E2E.articles.guaruja.slug}`)).status()).toBe(404);
  expect((await hostFetch(page, E2E.hosts.guaruja, "/portal/bairro/gonzaga")).status()).toBe(404);
});

test("SEO e cabecalhos: sitemap, robots, ads.txt e painel fora dos buscadores", async ({ page }) => {
  const sitemap = await hostFetch(page, E2E.hosts.guaruja, "/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain(`/portal/noticia/${E2E.articles.guaruja.slug}`);
  expect(xml).not.toContain(E2E.articles.santos.slug);
  expect((await hostFetch(page, E2E.hosts.guaruja, "/robots.txt")).status()).toBe(200);
  expect((await hostFetch(page, E2E.hosts.guaruja, "/ads.txt")).status()).toBe(200);

  const home = await hostFetch(page, E2E.hosts.guaruja, "/portal");
  expect(home.headers()["x-robots-tag"]).toBeUndefined();
  expect(home.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(home.headers()["x-powered-by"]).toBeUndefined();
  const panel = await hostFetch(page, "localhost", "/noticias");
  expect(panel.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

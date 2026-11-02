import { expect, test } from "@playwright/test";
import { E2E } from "./data";
import { login } from "./helpers";

// Autorizacao no servidor, vista pelo navegador.

test("sem login o painel nao mostra dados", async ({ page }) => {
  await page.goto("/noticias");
  await expect(page.getByRole("link", { name: /entrar/i }).first()).toBeVisible();
  await expect(page.getByText(E2E.articles.review.title)).toHaveCount(0);
});

test("editora de Santos nao ve a pauta de Guaruja", async ({ page }) => {
  await login(page, E2E.users.editorSantos);
  await page.goto("/noticias");
  await expect(page.getByText(E2E.articles.review.title)).toHaveCount(0);
});

test("parceiro vende no territorio, sem pauta da redacao nem operacao", async ({ page }) => {
  await login(page, E2E.users.partner);
  await page.goto("/comercial");
  await expect(page.getByText("Portal 24h Guarujá").first()).toBeVisible();
  await expect(page.locator("#rv_status option")).toHaveText(["Estimada"]);
  await page.goto("/noticias");
  await expect(page.getByText(E2E.articles.review.title)).toHaveCount(0);
  await page.goto("/parceiros");
  await expect(page.getByRole("heading", { name: E2E.partnerName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atribuir território" })).toHaveCount(0);
  await page.goto("/automacoes");
  await expect(page.getByText("Área da administração da rede e da operação técnica.")).toBeVisible();
});

test("administracao da rede ve a operacao da fila", async ({ page }) => {
  await login(page, E2E.users.admin);
  await page.goto("/automacoes");
  await expect(page.getByRole("heading", { name: "Jobs por tipo" })).toBeVisible();
  await expect(page.getByText("Coleta de fontes")).toBeVisible();
});

test("health interno exige o segredo do agendador e resume a fila", async ({ request }) => {
  expect((await request.get("/api/internal/health")).status()).toBe(401);
  test.skip(!process.env.CRON_SECRET, "CRON_SECRET nao exportado neste ambiente");
  const res = await request.get("/api/internal/health", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect([200, 503]).toContain(res.status());
  const body = await res.json();
  expect(body).toHaveProperty("queue.dead_letter");
  expect(Array.isArray(body.alerts)).toBe(true);
});

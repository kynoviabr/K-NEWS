import { expect, test } from "@playwright/test";
import { E2E, portalUrl } from "./data";
import { hostFetch, login } from "./helpers";

// Fluxo editorial completo: materia em revisao com evidencia -> decisao humana com nota
// -> no ar no portal -> retirada com motivo -> fora do ar.

test("editora aprova, materia vai ao ar e sai do ar com motivo", async ({ page }) => {
  await login(page, E2E.users.editor);
  await page.goto("/noticias");
  await page.getByRole("link", { name: E2E.articles.review.title }).click();
  await expect(page.getByRole("heading", { name: E2E.articles.review.title })).toBeVisible();

  // Sem nota a aprovacao e recusada pelo banco.
  await page.selectOption("#decision", "approve");
  await page.getByRole("button", { name: "Confirmar decisão" }).click();
  await expect(page.getByText(/nota editorial/)).toBeVisible();

  await page.fill("#note", "Conferido com o comunicado oficial da prefeitura (E2E).");
  await page.selectOption("#decision", "approve");
  await page.getByRole("button", { name: "Confirmar decisão" }).click();
  // Publicada, a tela troca o formulario de decisao pelo de retirada.
  await expect(page.getByRole("button", { name: "Retirar do ar" })).toBeVisible();

  const live = await hostFetch(page, E2E.hosts.guaruja, `/portal/noticia/${E2E.articles.review.slug}`);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain(E2E.articles.review.title);

  await page.fill("#reason", "Horário corrigido pela prefeitura (E2E).");
  await page.getByRole("button", { name: "Retirar do ar" }).click();
  // Fora do ar, a materia volta a aceitar decisao editorial.
  await expect(page.getByRole("button", { name: "Confirmar decisão" })).toBeVisible();
  await expect(page.getByText(/unpublished/)).toBeVisible();
  expect((await hostFetch(page, E2E.hosts.guaruja, `/portal/noticia/${E2E.articles.review.slug}`)).status()).toBe(404);
  await page.goto(portalUrl(E2E.hosts.guaruja, "/portal"));
  await expect(page.getByRole("link", { name: E2E.articles.review.title })).toHaveCount(0);
});

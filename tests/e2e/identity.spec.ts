import { expect, test } from "@playwright/test";
import { E2E, portalUrl } from "./data";
import { declineConsent, login } from "./helpers";

// Gestao envia logotipo e favicon; o portal da cidade passa a usar os arquivos.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("logotipo e favicon por portal, com arquivo conferido no servidor", async ({ page }) => {
  await login(page, E2E.users.admin);
  await page.goto("/localidades");
  const logoForm = page.locator("form", { has: page.locator("#asset-logo") });
  const iconForm = page.locator("form", { has: page.locator("#asset-icon") });

  // Texto com extensao .png nao passa: o servidor confere a assinatura do arquivo.
  await logoForm.locator("#asset-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
  await logoForm.getByRole("button", { name: "Enviar" }).click();
  await expect(logoForm.getByText("Formato aceito: PNG, JPEG ou WebP")).toBeVisible();

  await logoForm.locator("#asset-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await logoForm.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByAltText("Logotipo atual")).toBeVisible();
  await iconForm.locator("#asset-icon").setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: PNG });
  await iconForm.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByAltText("Ícone (favicon) atual")).toBeVisible();

  await page.goto(portalUrl(E2E.hosts.guaruja, "/"));
  await declineConsent(page);
  const logo = page.locator("header img");
  await expect(logo).toBeVisible();
  const src = (await logo.getAttribute("src"))!;
  expect(src).toMatch(new RegExp(`/storage/v1/object/public/knews-portal-assets/${E2E.portals.guaruja}/logo-[0-9a-f-]{36}\\.png$`));
  const file = await page.request.get(src);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("image/png");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /\/icon-[0-9a-f-]{36}\.png$/);

  // Santos segue com o nome em texto.
  await page.goto(portalUrl(E2E.hosts.santos, "/"));
  await expect(page.locator("header img")).toHaveCount(0);

  await page.goto("/localidades");
  for (const label of ["Logotipo", "Ícone (favicon)"]) {
    await page.getByRole("button", { name: `Remover ${label.toLowerCase()}` }).click();
    await expect(page.getByAltText(`${label} atual`)).toHaveCount(0);
  }
  await page.goto(portalUrl(E2E.hosts.guaruja, "/"));
  await expect(page.locator("header img")).toHaveCount(0);
  expect((await page.request.get(src)).status()).toBe(400);
});

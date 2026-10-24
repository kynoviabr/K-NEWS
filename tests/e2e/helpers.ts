import { expect, type Page } from "@playwright/test";
import { E2E } from "./data";

export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", E2E.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

// O cliente HTTP do Playwright nao resolve *.localhost; vai em 127.0.0.1 com o Host certo.
export async function hostFetch(page: Page, host: string, path: string) {
  const port = Number(process.env.E2E_PORT ?? 3100);
  return page.request.get(`http://127.0.0.1:${port}${path}`, { headers: { host: `${host}:${port}` }, maxRedirects: 0 });
}

export async function declineConsent(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Recusar" });
  if (await button.isVisible().catch(() => false)) await button.click();
  await expect(button).toBeHidden();
}

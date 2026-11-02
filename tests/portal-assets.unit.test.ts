import { afterEach, describe, expect, it } from "vitest";
import { assetProblem, isPortalAssetPath, newAssetPath, portalAssetUrl, sniffImageType } from "@/lib/portal-assets";

const P = "00000000-0000-4000-8000-000000000021";
const U = "11111111-2222-4333-8444-555555555555";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe("logotipo e favicon do portal", () => {
  it("caminho valido so do proprio portal e do tipo certo", () => {
    expect(newAssetPath(P, "logo", "image/png", U)).toBe(`${P}/logo-${U}.png`);
    expect(isPortalAssetPath(`${P}/logo-${U}.png`, P, "logo")).toBe(true);
    expect(isPortalAssetPath(`${P}/logo-${U}.png`, P, "icon")).toBe(false);
    expect(isPortalAssetPath(`${P}/logo-${U}.png`, "00000000-0000-4000-8000-000000000022", "logo")).toBe(false);
    expect(isPortalAssetPath(`${P}/../logo-${U}.png`, P, "logo")).toBe(false);
    expect(isPortalAssetPath(`${P}/logo-${U}.svg`, P, "logo")).toBe(false);
    expect(isPortalAssetPath(42, P, "logo")).toBe(false);
  });

  it("URL publica do Storage apenas para caminho valido", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co/";
    expect(portalAssetUrl({ logo_path: `${P}/logo-${U}.webp` }, P, "logo")).toBe(`https://exemplo.supabase.co/storage/v1/object/public/knews-portal-assets/${P}/logo-${U}.webp`);
    expect(portalAssetUrl({ logo_path: "https://evil.example/x.png" }, P, "logo")).toBeNull();
    expect(portalAssetUrl({}, P, "icon")).toBeNull();
  });

  it("confere a assinatura do arquivo, nao o tipo declarado", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(assetProblem("icon", 200 * 1024, "image/png")).toMatch(/128 KB/);
    expect(assetProblem("logo", 100, null)).toMatch(/PNG/);
    expect(assetProblem("logo", 100, "image/png")).toBeNull();
  });
});

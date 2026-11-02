import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { asActor, connect, tryQuery } from "./db";
import { IDS, seed } from "./fixtures";

// Logotipo e favicon: bucket publico, mas so a gestao do proprio portal grava.
const U = "11111111-2222-4333-8444-555555555555";
const guaruja = (kind: string, ext = "png") => `${IDS.portalGuaruja}/${kind}-${U}.${ext}`;
let pg: Client;

async function cleanup() {
  await pg.query("begin");
  await pg.query("set local storage.allow_delete_query = 'true'").catch(() => undefined);
  await pg.query("delete from storage.objects where bucket_id = 'knews-portal-assets' and name like '%" + U + "%'");
  await pg.query("commit");
}

beforeAll(async () => {
  pg = await connect();
  await seed(pg);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pg.end();
});

const put = (c: Client, name: string) =>
  tryQuery(c, "insert into storage.objects (bucket_id, name, metadata) values ('knews-portal-assets', $1, '{\"mimetype\":\"image/png\"}')", [name]);

describe("knews-portal-assets", () => {
  it("bucket publico, sem SVG e com limite de tamanho", async () => {
    const b = (await pg.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'knews-portal-assets'")).rows[0];
    expect(b).toEqual({ public: true, file_size_limit: "524288", allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] });
  });

  it("gestao do portal grava; redacao, outro portal e nomes fora do padrao nao", async () => {
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      expect((await put(c, guaruja("logo"))).error).toBeNull();
      expect((await put(c, guaruja("banner"))).error).toMatch(/row-level security/);
      expect((await put(c, `${IDS.portalGuaruja}/../logo-${U}.png`)).error).toMatch(/row-level security/);
      expect((await put(c, `${IDS.portalSantos}/logo-${U}.png`)).error).toMatch(/row-level security/);
    });
    for (const userId of [IDS.editorGuaruja, IDS.commercialGuaruja, IDS.outsider]) {
      await asActor(pg, { role: "authenticated", userId }, async (c) => {
        expect((await put(c, guaruja("icon"))).error, userId).toMatch(/row-level security/);
      });
    }
    await asActor(pg, { role: "authenticated", userId: IDS.superAdmin }, async (c) => {
      expect((await put(c, `${IDS.portalSantos}/icon-${U}.webp`)).error).toBeNull();
    });
    await asActor(pg, { role: "anon" }, async (c) => {
      expect((await put(c, guaruja("icon", "jpg"))).error).toMatch(/row-level security|permission denied/);
    });
  });
});

describe("tema do portal", () => {
  it("aceita caminho do proprio portal e recusa outro portal ou URL externa", async () => {
    await asActor(pg, { role: "authenticated", userId: IDS.managerGuaruja }, async (c) => {
      const set = (theme: object) => tryQuery(c, "update knews.portals set theme = $2 where id = $1", [IDS.portalGuaruja, JSON.stringify(theme)]);
      expect((await set({ logo_text: "Guarujá", logo_path: guaruja("logo"), icon_path: guaruja("icon", "webp") })).error).toBeNull();
      expect((await set({ logo_path: `${IDS.portalSantos}/logo-${U}.png` })).error).toMatch(/knews_portals_assets_own/);
      expect((await set({ logo_path: "https://evil.example/logo.png" })).error).toMatch(/knews_portals_(theme_valid|assets_own)/);
      expect((await set({ icon_path: guaruja("logo") })).error).toMatch(/knews_portals_theme_valid/);
    });
  });
});

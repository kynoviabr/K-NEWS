import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");

describe("K-NEWS scaffold — Fase 0", () => {
  it("tem globals.css com tokens K-NEWS (não copia branding BLOGGER)", () => {
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    expect(css).toContain("--knews-primary");
    expect(css).toContain("--sidebar-background");
  });

  it("tem database.types com schema knews", () => {
    const types = readFileSync(path.join(root, "lib/database.types.ts"), "utf8");
    expect(types).toContain("knews:");
    expect(types).toContain("RiskLevel");
    expect(types).toContain("blocked");
  });

  it("tem migration de fundação knews não aplicada", () => {
    expect(existsSync(path.join(root, "supabase/migrations/20261021000001_knews_foundation.sql"))).toBe(true);
    const sql = readFileSync(path.join(root, "supabase/migrations/20261021000001_knews_foundation.sql"), "utf8");
    expect(sql).toContain("create schema if not exists knews");
    expect(sql).toContain("knews.jobs");
    expect(sql).toContain("can_read_portal");
    expect(sql).not.toContain("from public.background_jobs");
    expect(sql).not.toContain("public.background_jobs\"");
  });

  it("tem docs da Fase 0", () => {
    for (const doc of ["AUDIT-BLOGGER.md", "ARCHITECTURE.md", "DATABASE-ISOLATION.md", "IMPLEMENTATION-ROADMAP.md", "DECISIONS.md"]) {
      expect(existsSync(path.join(root, `docs/${doc}`))).toBe(true);
    }
  });

  it("tem validação de portal com zod", () => {
    const schema = readFileSync(path.join(root, "lib/validations/portal.schema.ts"), "utf8");
    expect(schema).toContain("createPortalSchema");
  });
});

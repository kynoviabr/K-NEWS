import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { classifyGraphError, sanitizeGraphMessage } from "@/lib/social/meta-graph";
import { decryptToken, encryptToken, tokenAad } from "@/lib/social/token-crypto";
import { composeMessage } from "@/lib/social/publisher";

const KEY = randomBytes(32).toString("base64");

describe("token cifrado", () => {
  it("ida e volta, amarrado ao portal e a rede", () => {
    const aad = tokenAad("p1", "facebook");
    const c = encryptToken("EAAsegredo", aad, KEY);
    expect(c).toMatch(/^v1:/);
    expect(c).not.toContain("EAAsegredo");
    expect(decryptToken(c, aad, KEY)).toBe("EAAsegredo");
    expect(() => decryptToken(c, tokenAad("p2", "facebook"), KEY)).toThrow();
    expect(() => decryptToken(c, aad, randomBytes(32).toString("base64"))).toThrow();
    expect(() => encryptToken("x", aad, "curta")).toThrow(/KNEWS_SOCIAL_TOKEN_KEY/);
  });
});

describe("erros da Graph API", () => {
  it("classifica token, limite, transitorio e permanente", () => {
    expect(classifyGraphError(400, { error: { code: 190, message: "expired" } }).kind).toBe("auth");
    expect(classifyGraphError(400, { error: { code: 4, message: "limit" } }).kind).toBe("rate_limit");
    expect(classifyGraphError(429, null).kind).toBe("rate_limit");
    expect(classifyGraphError(503, null).kind).toBe("transient");
    expect(classifyGraphError(400, { error: { code: 100, is_transient: true } }).kind).toBe("transient");
    expect(classifyGraphError(400, { error: { code: 200, message: "permissao" } }).kind).toBe("permanent");
  });

  it("nunca devolve token em mensagem", () => {
    expect(sanitizeGraphMessage("falhou access_token=EAAabc123 e EAAabcdefghijklmnop")).toBe("falhou access_token=*** e ***");
  });
});

describe("texto do post", () => {
  it("Instagram leva o endereco no texto; Facebook usa o campo link", () => {
    expect(composeMessage("Oi", "https://x.test/a", "instagram")).toBe("Oi\n\nhttps://x.test/a");
    expect(composeMessage("Oi", "https://x.test/a", "facebook")).toBe("Oi");
  });
});

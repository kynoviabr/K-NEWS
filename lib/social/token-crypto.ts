import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Tokens da Meta ficam cifrados no banco (AES-256-GCM). A chave vive so no servidor
// (KNEWS_SOCIAL_TOKEN_KEY, 32 bytes em base64) e nunca vai para o banco nem para o browser.
// O AAD amarra o texto cifrado ao portal e a rede: copiar o valor para outra conta falha.

const VERSION = "v1";

function loadKey(keyB64: string | undefined): Buffer {
  const key = Buffer.from(keyB64 ?? "", "base64");
  if (key.length !== 32) throw new Error("KNEWS_SOCIAL_TOKEN_KEY ausente ou invalida (32 bytes em base64).");
  return key;
}

export function tokenAad(portalId: string, provider: string): string {
  return `${portalId}:${provider}`;
}

export function encryptToken(plain: string, aad: string, keyB64 = process.env.KNEWS_SOCIAL_TOKEN_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(keyB64), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptToken(value: string, aad: string, keyB64 = process.env.KNEWS_SOCIAL_TOKEN_KEY): string {
  const [version, iv, tag, ct] = value.split(":");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("token cifrado em formato desconhecido");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(keyB64), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

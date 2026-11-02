// Logotipo e favicon do portal no bucket publico knews-portal-assets.
export const PORTAL_ASSETS_BUCKET = "knews-portal-assets";
export const ASSET_LIMITS = { logo: 512 * 1024, icon: 128 * 1024 } as const;
export type AssetKind = keyof typeof ASSET_LIMITS;

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
type AssetType = keyof typeof EXT;

const PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(logo|icon)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function isPortalAssetPath(path: unknown, portalId: string, kind: AssetKind): path is string {
  if (typeof path !== "string") return false;
  const m = PATH.exec(path);
  return Boolean(m && m[1] === portalId && m[2] === kind);
}

export function newAssetPath(portalId: string, kind: AssetKind, type: AssetType, id: string = crypto.randomUUID()): string {
  return `${portalId}/${kind}-${id}.${EXT[type]}`;
}

// URL publica so para caminhos validos do proprio portal (o tema e JSON livre no banco).
export function portalAssetUrl(theme: Record<string, unknown> | null | undefined, portalId: string, kind: AssetKind): string | null {
  const path = theme?.[`${kind}_path`];
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !isPortalAssetPath(path, portalId, kind)) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${PORTAL_ASSETS_BUCKET}/${path}`;
}

// O tipo declarado pelo navegador nao basta: confere a assinatura do arquivo.
export function sniffImageType(bytes: Uint8Array): AssetType | null {
  const at = (i: number, sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

export function assetProblem(kind: AssetKind, size: number, type: AssetType | null): string | null {
  if (size === 0) return "Escolha um arquivo de imagem";
  if (!type) return "Formato aceito: PNG, JPEG ou WebP";
  if (size > ASSET_LIMITS[kind]) return kind === "logo" ? "Logotipo acima de 512 KB" : "Ícone acima de 128 KB";
  return null;
}

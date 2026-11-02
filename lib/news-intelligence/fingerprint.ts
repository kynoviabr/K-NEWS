// Chaves de deduplicacao persistente (knews.processed_canonicals / source_items).

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$)/i;

export function canonicalDedupKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    return `${u.hostname}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const STOPWORDS = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre e ou que se ao aos à às é sao foi ser tem pelo pela pelos pelas apos ate mais menos".split(" "),
);

// Titulo normalizado: mesma noticia republicada por outro veiculo com pequenas variacoes
// (acentos, caixa, ordem, sufixo " - Veiculo") gera o mesmo fingerprint.
export function titleFingerprint(title: string): string {
  const withoutOutlet = title.replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, "");
  const tokens = foldText(withoutOutlet)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(" ");
}

export function slugify(title: string, suffix: string): string {
  const base = foldText(title)
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 10)
    .join("-");
  return `${base || "noticia"}-${suffix}`.slice(0, 120);
}

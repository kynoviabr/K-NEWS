const CITY_HINTS: Record<string, string[]> = {
  guaruja: ["guaruja", "pereque", "vicente de carvalho", "enseada"],
  santos: ["santos", "gonzaga", "orla de santos"],
};

export function classifyCity(text: string, candidates: string[]): string | null {
  const low = text.toLowerCase();
  for (const city of candidates) {
    const hints = CITY_HINTS[city] ?? [city];
    if (hints.some((h) => low.includes(h))) return city;
  }
  return null;
}

// Classificacao territorial a partir do cadastro (cidades e bairros do banco),
// sem acentos/caixa e por palavra inteira para evitar falsos positivos.
export type TerritoryCatalog = {
  cities: Array<{ id: string; name: string; slug: string }>;
  neighborhoods: Array<{ id: string; name: string; cityId: string }>;
};

export type TerritoryMatch = { cityId: string | null; neighborhoodId: string | null; matched: string[] };

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function mentions(haystack: string, name: string): boolean {
  const needle = fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(haystack);
}

export function classifyTerritory(text: string, catalog: TerritoryCatalog): TerritoryMatch {
  const hay = fold(text);
  const matched: string[] = [];
  let neighborhoodId: string | null = null;
  let cityId: string | null = null;
  for (const n of catalog.neighborhoods) {
    if (mentions(hay, n.name)) {
      matched.push(n.name);
      neighborhoodId ??= n.id;
      cityId ??= n.cityId;
    }
  }
  for (const c of catalog.cities) {
    if (mentions(hay, c.name)) {
      matched.push(c.name);
      cityId ??= c.id;
    }
  }
  return { cityId, neighborhoodId, matched };
}

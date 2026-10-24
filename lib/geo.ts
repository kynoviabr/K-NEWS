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

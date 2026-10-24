// Identidade visual por portal: cores do tema viram variaveis CSS do portal publico.
// Puro (sem Next), testado em unidade.

export type PortalTheme = { primary?: string; accent?: string; tagline?: string; logo_text?: string };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX.test(v);
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// "188 92% 38%": formato das variaveis HSL do design system (globals.css).
export function hexToHslComponents(hex: string): string {
  const [r, g, b] = channels(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

// Texto branco sobre a cor principal precisa de contraste AA (4.5:1).
export function themeProblems(theme: PortalTheme): string[] {
  const problems: string[] = [];
  if (theme.primary !== undefined) {
    if (!isHexColor(theme.primary)) problems.push("Cor principal: use o formato #RRGGBB");
    else if (contrastRatio(theme.primary, "#ffffff") < 4.5) problems.push("Cor principal clara demais: texto branco sobre ela fica ilegível (contraste mínimo 4,5:1)");
  }
  if (theme.accent !== undefined && !isHexColor(theme.accent)) problems.push("Cor de destaque: use o formato #RRGGBB");
  if ((theme.tagline ?? "").length > 120) problems.push("Slogan: até 120 caracteres");
  if ((theme.logo_text ?? "").length > 40) problems.push("Nome no logotipo: até 40 caracteres");
  return problems;
}

// Variaveis CSS aplicadas no contêiner do portal. So valores validados entram.
export function themeCssVars(theme: Record<string, unknown> | null | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  if (theme && isHexColor(theme.primary)) {
    vars["--knews-primary"] = hexToHslComponents(theme.primary);
    vars["--primary"] = hexToHslComponents(theme.primary);
  }
  if (theme && isHexColor(theme.accent)) vars["--knews-accent"] = hexToHslComponents(theme.accent);
  return vars;
}

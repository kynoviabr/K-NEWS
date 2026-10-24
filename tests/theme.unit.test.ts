import { describe, expect, it } from "vitest";
import { contrastRatio, hexToHslComponents, themeCssVars, themeProblems } from "@/lib/theme";

describe("tema por portal", () => {
  it("converte hex para componentes HSL do design system", () => {
    expect(hexToHslComponents("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslComponents("#000000")).toBe("0 0% 0%");
    expect(hexToHslComponents("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslComponents("#0e7490")).toBe("193 82% 31%");
  });

  it("exige contraste AA do texto branco sobre a cor principal", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(themeProblems({ primary: "#0e7490" })).toEqual([]);
    expect(themeProblems({ primary: "#fde047" })[0]).toMatch(/clara demais/);
    expect(themeProblems({ primary: "red" })[0]).toMatch(/#RRGGBB/);
    expect(themeProblems({ tagline: "x".repeat(121) })[0]).toMatch(/Slogan/);
  });

  it("so gera variaveis CSS de valores validos", () => {
    expect(themeCssVars({ primary: "#0e7490", accent: "#f59e0b" })).toEqual({
      "--knews-primary": "193 82% 31%",
      "--primary": "193 82% 31%",
      "--knews-accent": "38 92% 50%",
    });
    expect(themeCssVars({ primary: "red;} body{display:none" })).toEqual({});
    expect(themeCssVars(null)).toEqual({});
  });
});

import type { Config } from "tailwindcss";

const h = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./modules/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: h("--background"),
        foreground: h("--foreground"),
        card: h("--card"),
        "card-foreground": h("--card-foreground"),
        primary: h("--primary"),
        "primary-foreground": h("--primary-foreground"),
        secondary: h("--secondary"),
        "secondary-foreground": h("--secondary-foreground"),
        muted: h("--muted"),
        "muted-foreground": h("--muted-foreground"),
        accent: h("--accent"),
        "accent-foreground": h("--accent-foreground"),
        destructive: h("--destructive"),
        "destructive-foreground": h("--destructive-foreground"),
        border: h("--border"),
        input: h("--input"),
        ring: h("--ring"),
        success: h("--success"),
        warning: h("--warning"),
        info: h("--info"),
        navy: h("--bg-navy"),
        knews: h("--knews-primary"),
        "knews-foreground": h("--knews-primary-foreground"),
      },
      fontFamily: {
        sans: ["var(--font-body)"],
        heading: ["var(--font-heading)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        "brand-btn": "var(--radius-btn)",
        "brand-card": "var(--radius-card)",
        "brand-modal": "var(--radius-modal)",
      },
      boxShadow: {
        card: "var(--shadow-sm)",
        "card-hover": "var(--shadow-md)",
        glow: "var(--shadow-glow)",
      },
    },
  },
  plugins: [],
};

export default config;

import { PRIMARY_DOMAIN } from "@/lib/domains";

export const siteConfig = {
  name: "K-NEWS",
  title: "K-NEWS — Rede de Notícias Hiperlocais",
  description: "Rede própria de portais jornalísticos da Kynovia — Guarujá e região, com apuração, evidências e monetização responsável.",
  version: "0.1.0-fase0",
  locale: "pt-BR",
  links: {
    portal: `https://${PRIMARY_DOMAIN}`,
  },
} as const;

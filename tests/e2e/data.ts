// Dados sinteticos compartilhados entre a preparacao e os testes E2E.
export const E2E = {
  password: "senha-e2e-123",
  users: {
    editor: "e2e.editora@knews.test",
    editorSantos: "e2e.editora.santos@knews.test",
    admin: "e2e.admin@knews.test",
    partner: "e2e.parceiro@knews.test",
  },
  portals: { guaruja: "10000000-0000-4000-8000-000000000021", santos: "10000000-0000-4000-8000-000000000022" },
  cities: { guaruja: "10000000-0000-4000-8000-000000000011" },
  hosts: { guaruja: "guaruja.localhost", santos: "santos.localhost" },
  articles: {
    guaruja: { slug: "e2e-feira-pereque", title: "E2E Feira de artesanato volta ao Perequê" },
    santos: { slug: "e2e-feira-santos", title: "E2E Feira de artesanato no Gonzaga" },
    review: { slug: "e2e-ubs-enseada", title: "E2E UBS da Enseada amplia horário" },
  },
  partnerName: "E2E Parceiro Litoral",
  adHeadline: "E2E Padaria do Perequê",
  adUrl: "https://anunciante.example/e2e-padaria",
} as const;

export function portalUrl(host: string, path: string, port = Number(process.env.E2E_PORT ?? 3100)): string {
  return `http://${host}:${port}${path}`;
}

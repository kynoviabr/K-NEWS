# Staging — Ambiente de homologacao separado

> **Nao aplicar migrations em producao sem aprovacao.** Todas as migrations em `supabase/migrations/` estao com header `NAO APLICAR EM PRODUCAO`.

## Projeto Supabase de staging

Crie um **projeto Supabase novo e vazio** para homologacao (nao reutilize `pnhxvhjudtrzvwduuigj` do BLOGGER).

```bash
supabase link --project-ref <STAGING_REF>
supabase db push --linked   # aplica supabase/migrations/ em ordem
supabase functions deploy knews-jobs knews-publish
```

## Variaveis

Copie `.env.example` para `.env` e `.env.local` com credenciais do projeto de staging **(sem segredos do BLOGGER)**.

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — staging
- `SUPABASE_SERVICE_ROLE_KEY` — staging
- `CRON_SECRET` — gere novo `openssl rand -hex 32`
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` local ou URL Vercel preview
- `portal24h.news` wildcard **nao** aponta DNS em staging; teste por `Host` header ou `/etc/hosts`

## Validacao

```bash
npm run typecheck && npm test && npm run build
# Integracao contra staging (após db push):
# - knews.jobs claim com 2 workers (SKIP LOCKED)
# - lease expirado / worker interrompido / retry / DLQ
# - reserve_ad idempotente + isolamento por cidade/host
# - sitemap/robots por portal
```

## Dados

Sem dados reais nem segredos do BLOGGER. Crie `knews.cities`/`knews.portals`/`knews.portal_domains` ficticios (`guaruja`, `santos`) e campanhas de teste.

## Vercel wildcard

`*.portal24h.news` em Vercel → Domains — apenas apos homologacao e autorizacao de DNS (`*.portal24h.news` → `cname.vercel-dns.com`).

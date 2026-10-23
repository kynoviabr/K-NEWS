# Launch Checklist — Guarujá (K-NEWS)

> Não publicar sem homologação em staging separado e aprovação explícita.

- [ ] Supabase staging: `supabase db push` OK (11 migrations), RLS Guarujá vs Santos validado
- [ ] Jobs: 2 workers concorrentes sem duplicação, lease/retry/DLQ, expire_stale_reservations
- [ ] Editorial: sensiveis bloqueados, claims vs evidencias, IA mock falha → blocked
- [ ] Ads: reserve_ad idempotente, cap/orçamento/placements/geo, expiração, decision por cidade
- [ ] Portal: guaruja.portal24h.news e santos.portal24h.news com SEO/canonical/sitemap isolados
- [ ] Observabilidade: audit_logs, job_events, ad_events, get_job_health
- [ ] Backup: PITR Supabase + dumps
- [ ] Kill switch: canPublish() testado, despublicação de artigos
- [ ] Vercel: wildcard *.portal24h.news configurado (sem DNS até autorizado)
- [ ] LGPD: Vault para tokens, sem segredos BLOGGER em staging

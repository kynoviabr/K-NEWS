import { connect } from "../integration/db";
import { serviceClient } from "../integration/supabase";
import { E2E } from "./data";

// Prepara dados sinteticos no Supabase LOCAL (connect/serviceClient recusam host remoto).
// Idempotente: apaga o que tiver prefixo e2e e recria.
export default async function globalSetup(): Promise<void> {
  const admin = serviceClient();
  const pg = await connect();
  const ids: Record<string, string> = {};
  for (const email of Object.values(E2E.users)) {
    const created = await admin.auth.admin.createUser({ email, password: E2E.password, email_confirm: true });
    if (created.error && !/already/i.test(created.error.message)) throw created.error;
    const row = await pg.query<{ id: string }>("select id from auth.users where email = $1", [email]);
    if (!row.rows[0]) throw new Error(`usuario ${email} nao encontrado`);
    ids[email] = row.rows[0].id;
  }

  try {
    const { portals, articles } = E2E;
    await pg.query("delete from knews.partner_commissions where partner_id in (select id from knews.partners where name = $1)", [E2E.partnerName]);
    await pg.query("delete from knews.partners where name = $1", [E2E.partnerName]);
    await pg.query("delete from knews.ad_campaigns where name like 'E2E %'");
    await pg.query("delete from knews.ad_contracts where reference like 'E2E-%'");
    await pg.query("delete from knews.advertisers where name like 'E2E %'");
    await pg.query("delete from knews.articles where slug like 'e2e-%'");
    await pg.query("delete from knews.portal_members where user_id = any($1)", [Object.values(ids)]);

    await pg.query(
      `insert into knews.portal_members (portal_id, user_id, role) values
         ($1, $3, 'regional_editor'), ($2, $4, 'regional_editor'), ($1, $5, 'super_admin')`,
      [portals.guaruja, portals.santos, ids[E2E.users.editor], ids[E2E.users.editorSantos], ids[E2E.users.admin]],
    );

    // Materias publicadas sinteticas (a publicacao pelo fluxo humano e coberta no spec editorial).
    const body = "Texto sintetico de teste E2E. ".repeat(10);
    await pg.query("set session_replication_role = replica");
    await pg.query(
      `insert into knews.articles (portal_id, slug, title, excerpt, body, status, category, neighborhood_id, published_at) values
         ($1, $3, $4, 'Artesanato local', $7, 'published', 'cultura', (select id from knews.neighborhoods where slug = 'pereque' and city_id = $8), now()),
         ($2, $5, $6, 'Artesanato local', $7, 'published', 'cultura', null, now())`,
      [portals.guaruja, portals.santos, articles.guaruja.slug, articles.guaruja.title, articles.santos.slug, articles.santos.title, body, E2E.cities.guaruja],
    );
    await pg.query("set session_replication_role = origin");

    // Materia em revisao com evidencia, pronta para a decisao humana.
    const review = await pg.query<{ id: string }>(
      `insert into knews.articles (portal_id, slug, title, excerpt, body, status, risk_level) values
         ($1, $2, $3, 'Atendimento estendido', $4, 'reviewing', 'medium') returning id`,
      [portals.guaruja, articles.review.slug, articles.review.title, `A Prefeitura informou que a UBS da Enseada passa a atender até as 20h. ${body}`],
    );
    await pg.query(
      `insert into knews.article_evidences (article_id, source_url, source_label, source_type, content_snippet)
       values ($1, 'https://www.guaruja.sp.gov.br/e2e', 'guaruja.sp.gov.br', 'official', 'UBS da Enseada atende até as 20h')`,
      [review.rows[0]!.id],
    );

    // Campanha paga ativa no topo do artigo de Guaruja.
    const adv = await pg.query<{ id: string }>("insert into knews.advertisers (name, portal_id) values ('E2E Padaria', $1) returning id", [portals.guaruja]);
    const contract = await pg.query<{ id: string }>(
      `insert into knews.ad_contracts (advertiser_id, portal_id, reference, status, starts_on, ends_on, total_value_cents, signed_at)
       values ($1, $2, 'E2E-001', 'signed', current_date - 1, current_date + 30, 100000, now()) returning id`,
      [adv.rows[0]!.id, portals.guaruja],
    );
    const campaign = await pg.query<{ id: string }>(
      `insert into knews.ad_campaigns (advertiser_id, portal_id, contract_id, kind, name, status, starts_at, ends_at, priority)
       values ($1, $2, $3, 'direct', 'E2E Padaria', 'draft', now() - interval '1 day', now() + interval '20 days', 500) returning id`,
      [adv.rows[0]!.id, portals.guaruja, contract.rows[0]!.id],
    );
    const cid = campaign.rows[0]!.id;
    await pg.query("insert into knews.ad_campaign_placements (campaign_id, slot_code) values ($1, 'artigo-topo')", [cid]);
    await pg.query(
      `insert into knews.ad_creatives (campaign_id, format, headline, body_text, click_url, status) values ($1, 'text', $2, 'Pão quentinho', $3, 'approved')`,
      [cid, E2E.adHeadline, E2E.adUrl],
    );
    await pg.query("update knews.ad_campaigns set status = 'active' where id = $1", [cid]);

    // Parceiro com territorio em Guaruja: o acesso vem do territorio.
    const partner = await pg.query<{ id: string }>("insert into knews.partners (name) values ($1) returning id", [E2E.partnerName]);
    await pg.query("insert into knews.partner_users (partner_id, user_id) values ($1, $2)", [partner.rows[0]!.id, ids[E2E.users.partner]]);
    await pg.query("insert into knews.partner_territories (partner_id, city_id, commission_pct) values ($1, $2, 10)", [partner.rows[0]!.id, E2E.cities.guaruja]);
  } finally {
    await pg.end();
  }
}

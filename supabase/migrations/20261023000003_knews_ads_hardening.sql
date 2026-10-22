-- K-NEWS Ad Management hardening — elegibilidade, caps, orcamento, rotacao, encerramento
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA

alter table knews.ad_campaigns add column if not exists impressions_cap integer check (impressions_cap is null or impressions_cap > 0);
alter table knews.ad_campaigns add column if not exists impressions_served integer not null default 0 check (impressions_served >= 0);
alter table knews.ad_campaigns add column if not exists budget_cents integer check (budget_cents is null or budget_cents > 0);
alter table knews.ad_campaigns add column if not exists budget_spent_cents integer not null default 0 check (budget_spent_cents >= 0);
alter table knews.ad_campaigns add column if not exists frequency_cap_per_user integer check (frequency_cap_per_user is null or frequency_cap_per_user > 0);
alter table knews.ad_campaigns add column if not exists priority smallint not null default 100 check (priority between 0 and 1000);

create table if not exists knews.ad_campaign_placements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  slot_code text not null references knews.ad_slots(code) on delete cascade,
  priority smallint not null default 100 check (priority between 0 and 1000),
  unique(campaign_id, slot_code)
);

create table if not exists knews.ad_campaign_geo_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  city_slug text,
  portal_slug text,
  check (city_slug is not null or portal_slug is not null),
  unique(campaign_id, coalesce(city_slug, ''), coalesce(portal_slug, ''))
);

alter table knews.ad_campaign_placements enable row level security;
alter table knews.ad_campaign_geo_targets enable row level security;

revoke all on knews.ad_campaign_placements, knews.ad_campaign_geo_targets from anon;
grant select, insert, update, delete on knews.ad_campaign_placements, knews.ad_campaign_geo_targets to authenticated;
grant all on knews.ad_campaign_placements, knews.ad_campaign_geo_targets to service_role;

create policy knews_ad_placements_select on knews.ad_campaign_placements for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and (c.portal_id is null or knews.can_read_portal(c.portal_id)))
);
create policy knews_ad_geo_select on knews.ad_campaign_geo_targets for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and (c.portal_id is null or knews.can_read_portal(c.portal_id)))
);

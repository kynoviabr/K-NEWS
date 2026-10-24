-- K-NEWS Ad Storage — criativos em Supabase Storage
-- NAO APLICAR EM PRODUCAO SEM APROVACAO EXPLICITA
-- Bucket knews-creative: objetos em knews-creative/<campaign_id>/<uuid>-<file>

insert into storage.buckets (id, name, public) values ('knews-creative', 'knews-creative', false)
on conflict (id) do nothing;

create policy "knews_creative_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'knews-creative');

create policy "knews_creative_select" on storage.objects for select to authenticated
using (bucket_id = 'knews-creative');

create table if not exists knews.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references knews.ad_campaigns(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes int not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_knews_creatives_campaign on knews.ad_creatives(campaign_id);

alter table knews.ad_creatives enable row level security;
revoke all on knews.ad_creatives from anon;
grant select, insert, update, delete on knews.ad_creatives to authenticated;
grant all on knews.ad_creatives to service_role;
create policy knews_creatives_select on knews.ad_creatives for select to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and (c.portal_id is null or knews.can_read_portal(c.portal_id)))
);
create policy knews_creatives_write on knews.ad_creatives for all to authenticated using (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_edit_portal(c.portal_id))
) with check (
  exists (select 1 from knews.ad_campaigns c where c.id = campaign_id and knews.can_edit_portal(c.portal_id))
);

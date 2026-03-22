create table if not exists webhook_receipts (
  id           uuid        primary key default gen_random_uuid(),
  provider     text        not null default 'deepgram',
  request_id   text        not null,
  project_id   uuid        references projects(id) on delete set null,
  status       text        not null default 'processing'
                 check (status in ('processing', 'completed', 'failed')),
  attempt_id   uuid        not null default gen_random_uuid(),
  claimed_at   timestamptz not null default now(),
  processed_at timestamptz,
  last_error   text,
  received_at  timestamptz not null default now(),
  constraint uq_webhook_receipt unique (provider, request_id)
);

create index if not exists idx_webhook_receipts_project
  on webhook_receipts(project_id);

alter table webhook_receipts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'webhook_receipts'
      and policyname = 'Service role has full access to webhook_receipts'
  ) then
    create policy "Service role has full access to webhook_receipts"
      on public.webhook_receipts
      as permissive
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

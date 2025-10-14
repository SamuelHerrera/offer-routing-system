-- Extensions
create extension if not exists pgcrypto;
create extension if not exists pgmq cascade;

-- Queues
select * from pgmq.create('submission_queue');
select * from pgmq.create('submission_dlq');
select * from pgmq.create('routing_queue');
select * from pgmq.create('compile_queue');
select * from pgmq.create('route_partnerx_queue');
select * from pgmq.create('route_partnerx_dlq');

-- Tables
create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  priority int not null,
  predicate_json jsonb not null,
  route_name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_rules_priority on public.rules(priority);

create table if not exists public.decision_trees (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version int not null default 1,
  current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_decision_tree_current on public.decision_trees(current) where current = true;

create table if not exists public.partner_functions (
  name text primary key,
  dedupe_js text not null,
  handler_js text not null,
  retry_max int not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_configs (
  partner_name text primary key references public.partner_functions(name) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_identities (
  id uuid primary key default gen_random_uuid(),
  email text,
  full_name text,
  phone text,
  alias_of uuid references public.lead_identities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_lead_ident_email on public.lead_identities(lower(email));
create index if not exists idx_lead_ident_phone on public.lead_identities(phone);
create index if not exists idx_lead_ident_alias on public.lead_identities(alias_of);

create table if not exists public.leads (
  id bigserial primary key,
  person_id uuid not null references public.lead_identities(id) on delete cascade,
  alias_id uuid references public.lead_identities(id) on delete set null,
  partner_name text not null,
  dedupe_key text,
  status text not null default 'pending',
  request_date timestamptz not null default now(),
  response jsonb,
  error jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_leads_person on public.leads(person_id);
create index if not exists idx_leads_partner_dedupe on public.leads(partner_name, dedupe_key);

create table if not exists public.circuit_breakers (
  partner_name text primary key,
  open boolean not null default false,
  retry_after timestamptz,
  last_code int,
  updated_at timestamptz not null default now()
);

-- RPC wrappers for PGMQ
create or replace function public.enqueue_message(queue_name text, body jsonb)
returns bigint language sql stable as $$
  select pgmq.send(queue_name, body);
$$;

create or replace function public.dequeue_batch(queue_name text, vt_seconds int, batch_size int)
returns table (msg_id bigint, vt timestamptz, read_ct int, enqueued_at timestamptz, message jsonb)
language sql stable as $$
  select * from pgmq.read(queue_name, vt_seconds, batch_size);
$$;

create or replace function public.delete_message(queue_name text, msg_id bigint)
returns void language sql volatile as $$
  select pgmq.delete(queue_name, msg_id);
$$;

-- Simple queue metrics passthrough, may vary by pgmq version
create or replace function public.queue_metrics()
returns table (
  queue_name text,
  queue_length bigint,
  newest_msg_age_seconds bigint,
  oldest_msg_age_seconds bigint
)
language sql stable as $$
  select qname as queue_name, qlen as queue_length, newest, oldest from pgmq.metrics();
$$;

-- Helper: upsert rule
create or replace function public.upsert_rule(p_name text, p_priority int, p_predicate jsonb, p_route text, p_enabled boolean)
returns void language plpgsql as $$
begin
  insert into public.rules(name, priority, predicate_json, route_name, enabled)
  values (p_name, p_priority, p_predicate, p_route, p_enabled)
  on conflict(name) do update set priority = excluded.priority,
                                   predicate_json = excluded.predicate_json,
                                   route_name = excluded.route_name,
                                   enabled = excluded.enabled,
                                   updated_at = now();
end;
$$;

-- Policy: expose RPCs via anon key (restrict in production as needed)
alter function public.enqueue_message(text, jsonb) security definer;
alter function public.dequeue_batch(text, int, int) security definer;
alter function public.delete_message(text, bigint) security definer;
alter function public.queue_metrics() security definer;
alter function public.upsert_rule(text, int, jsonb, text, boolean) security definer;

-- Revoke public; grant to authenticated/edge
revoke all on function public.enqueue_message(text, jsonb) from public;
revoke all on function public.dequeue_batch(text, int, int) from public;
revoke all on function public.delete_message(text, bigint) from public;
revoke all on function public.queue_metrics() from public;
revoke all on function public.upsert_rule(text, int, jsonb, text, boolean) from public;

grant execute on function public.enqueue_message(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.dequeue_batch(text, int, int) to service_role;
grant execute on function public.delete_message(text, bigint) to service_role;
grant execute on function public.queue_metrics() to service_role;
grant execute on function public.upsert_rule(text, int, jsonb, text, boolean) to service_role;

-- Basic RLS setup for tables (tighten as needed)
alter table public.rules enable row level security;
create policy "read_rules" on public.rules for select using (true);

alter table public.partner_functions enable row level security;
create policy "read_partner_functions" on public.partner_functions for select using (true);

alter table public.partner_configs enable row level security;
create policy "read_partner_configs" on public.partner_configs for select using (true);

alter table public.decision_trees enable row level security;
create policy "read_decision_trees" on public.decision_trees for select using (true);

alter table public.lead_identities enable row level security;
create policy "read_lead_identities" on public.lead_identities for select using (true);

alter table public.leads enable row level security;
create policy "read_leads" on public.leads for select using (true);

alter table public.circuit_breakers enable row level security;
create policy "read_circuit_breakers" on public.circuit_breakers for select using (true);


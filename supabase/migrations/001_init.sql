-- Extensions
create extension if not exists pgcrypto;
create extension if not exists pgmq cascade;

-- Queues
select * from pgmq.create('submission_queue');
select * from pgmq.create('submission_dlq');
select * from pgmq.create('routing_queue');
select * from pgmq.create('routing_dlq');
select * from pgmq.create('compile_queue');

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

create table if not exists public.dynamic_functions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealer_configurations (
  name text primary key,
  value text not null
);

create table if not exists public.lead_identities (
  id uuid primary key default gen_random_uuid(),
  email text,
  full_name text,
  phone text,
  alias_of uuid references public.lead_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id bigserial primary key,
  dedupe_key text not null unique,
  person_id uuid not null references public.lead_identities(id) on delete cascade,
  alias_id uuid references public.lead_identities(id) on delete set null,
  dealer_name text not null,
  status text not null default 'pending',
  request_date timestamptz not null default now(),
  request jsonb,
  response jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.circuit_breakers (
  dealer_name text primary key,
  open boolean not null default false,
  retry_after timestamptz,
  last_code int,
  updated_at timestamptz not null default now()
);

create index if not exists idx_dynamic_function_name on public.dynamic_functions(name);
create index if not exists idx_lead_ident_email on public.lead_identities(lower(email));
create index if not exists idx_lead_ident_phone on public.lead_identities(phone);
create index if not exists idx_lead_ident_alias on public.lead_identities(alias_of);
create index if not exists idx_leads_person on public.leads(person_id);
create index if not exists idx_leads_dealer_dedupe on public.leads(dealer_name, dedupe_key);

-- Basic RLS
alter table public.rules enable row level security;
create policy "read_rules" on public.rules for select using (true);

alter table public.dynamic_functions enable row level security;
create policy "read_dynamic_functions" on public.dynamic_functions for select using (true);

alter table public.dealer_configurations enable row level security;
create policy "read_dealer_configurations" on public.dealer_configurations for select using (true);

alter table public.lead_identities enable row level security;
create policy "read_lead_identities" on public.lead_identities for select using (true);

alter table public.leads enable row level security;
create policy "read_leads" on public.leads for select using (true);

alter table public.circuit_breakers enable row level security;
create policy "read_circuit_breakers" on public.circuit_breakers for select using (true);


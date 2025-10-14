#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v psql >/dev/null 2>&1 && [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "psql is required unless SUPABASE_DB_URL is set for supabase db execute." >&2
fi

SEED_SQL=$(cat <<'SQL'
insert into public.partner_functions (name, dedupe_js, handler_js, retry_max) values (
  'partnerx',
  -- returns a string key used for duplicate detection
  'export default function dedupeKey(message) { return `${(message.email||"").toLowerCase()}|${message.phone||""}` }',
  -- partner call implementation stub
  'export default async function handler(message, config) { return { status: "ok", code: 200, data: { echoed: message } } }',
  3
) on conflict (name) do update set updated_at = now();

insert into public.partner_configs (partner_name, config) values (
  'partnerx', jsonb_build_object('endpoint', 'https://httpbin.org/post')
) on conflict (partner_name) do nothing;

insert into public.rules (name, priority, predicate_json, route_name, enabled)
values ('Default to PartnerX', 1000, '{"always": true}'::jsonb, 'partnerx', true)
on conflict (name) do update set updated_at = now();
SQL
)

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  echo "Seeding demo data into ${SUPABASE_DB_URL}"
  echo "$SEED_SQL" | PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1
else
  if ! command -v supabase >/dev/null 2>&1; then
    echo "Supabase CLI is required. Install from https://supabase.com/docs/guides/cli." >&2
    exit 1
  fi
  echo "Seeding demo data into local Supabase..."
  echo "$SEED_SQL" | supabase db execute
fi

echo "Demo seed complete."


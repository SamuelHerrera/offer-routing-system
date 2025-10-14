#!/usr/bin/env bash
set -euo pipefail

# Apply SQL migrations. Uses SUPABASE_DB_URL when provided, otherwise falls back to supabase local db.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is required when SUPABASE_DB_URL is set." >&2
    exit 1
  fi
  echo "Applying migrations with psql to ${SUPABASE_DB_URL}"
  for f in $(ls -1 ${ROOT_DIR}/supabase/migrations/*.sql | sort); do
    echo "Running $f"
    PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 -f "$f"
  done
else
  if ! command -v supabase >/dev/null 2>&1; then
    echo "Supabase CLI is required. Install from https://supabase.com/docs/guides/cli." >&2
    exit 1
  fi
  echo "Applying migrations to local Supabase..."
  supabase db reset --no-seed --db-url "postgres://postgres:postgres@127.0.0.1:54322/postgres" --schema public
  for f in $(ls -1 ${ROOT_DIR}/supabase/migrations/*.sql | sort); do
    echo "Running $f"
    supabase db execute --file "$f"
  done
fi

echo "Migrations applied."


#!/usr/bin/env bash
set -euo pipefail

# Deploy all edge functions using Supabase CLI

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required. Install from https://supabase.com/docs/guides/cli." >&2
  exit 1
fi

PROJECT_REF=${PROJECT_REF:-}
if [ -z "${PROJECT_REF}" ]; then
  echo "PROJECT_REF is not set. Export your Supabase project ref (e.g., abcdxyz)." >&2
  exit 1
fi

echo "Deploying edge functions to project ${PROJECT_REF}..."

cd "$(dirname "$0")/.."

for fn in supabase/functions/*; do
  [ -d "$fn" ] || continue
  name=$(basename "$fn")
  echo "Deploying function: $name"
  supabase functions deploy "$name" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo "Done."


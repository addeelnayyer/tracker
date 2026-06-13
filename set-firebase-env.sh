#!/bin/bash
# Sets production secrets for Firebase Functions via Google Secret Manager.
# Run once before first deploy, or whenever secrets change.
#
# Usage: bash set-firebase-env.sh

set -eo pipefail

FIREBASE="${HOME}/.nvm/versions/node/v24.8.0/bin/firebase"

if [[ ! -f .env ]]; then
  echo "ERROR: .env file not found. Run from the project root." >&2
  exit 1
fi

# Read a single value from .env by key name, stripping surrounding quotes
get_env() {
  local key="$1"
  local raw
  raw=$(grep -E "^${key}=" .env | head -1 | cut -d'=' -f2-)
  # Strip surrounding single or double quotes
  raw="${raw#\"}" ; raw="${raw%\"}"
  raw="${raw#\'}" ; raw="${raw%\'}"
  printf '%s' "$raw"
}

set_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "ERROR: $name is empty in .env" >&2
    exit 1
  fi
  echo "Setting $name..."
  printf '%s' "$value" | $FIREBASE functions:secrets:set "$name"
}

set_secret SESSION_SECRET    "$(get_env SESSION_SECRET)"
set_secret SA_PRIVATE_KEY_ID "$(get_env SA_PRIVATE_KEY_ID)"
set_secret SA_CLIENT_EMAIL   "$(get_env SA_CLIENT_EMAIL)"
set_secret SA_CLIENT_ID      "$(get_env SA_CLIENT_ID)"
set_secret RESEND_API_KEY    "$(get_env RESEND_API_KEY)"

# Private key: stored with literal \n in .env — convert to real newlines for Secret Manager
RAW_KEY=$(get_env SA_PRIVATE_KEY)
REAL_KEY=$(printf '%b' "$RAW_KEY")
echo "Setting SA_PRIVATE_KEY..."
printf '%s' "$REAL_KEY" | $FIREBASE functions:secrets:set SA_PRIVATE_KEY

echo ""
echo "Done. All 6 secrets are in Secret Manager."
echo "Non-sensitive vars come from .env automatically on firebase deploy."

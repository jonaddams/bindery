#!/usr/bin/env bash
# Bring up Document Engine with the local keypair exported into the environment.
#
# `docker compose` cannot read a multi-line PEM out of an .env file, so the key
# is exported here instead. Arguments are passed through to `docker compose`;
# with none, it runs `up -d`.
set -euo pipefail
cd "$(dirname "$0")"
[ -f secrets/jwt-public.pem ] || ./generate-keys.sh
DOCUMENT_ENGINE_JWT_PUBLIC_KEY="$(cat secrets/jwt-public.pem)"
export DOCUMENT_ENGINE_JWT_PUBLIC_KEY
if [ "$#" -eq 0 ]; then
  exec docker compose up -d
fi
exec docker compose "$@"

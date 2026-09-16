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

# The licence key, if there is one. Without it the engine runs in evaluation
# mode: every feature, but a watermark on output, a 50 MB input cap and a 100 s
# processing timeout.
#
# Read from the repo's .env.local when the shell does not already carry it,
# because that is where it lives for everything else and requiring it to be
# exported by hand is how it ends up forgotten. Extracted by name rather than by
# sourcing the file: .env.local holds a multi-line PEM, which `source` would
# mangle or choke on.
if [ -z "${DOCUMENT_ENGINE_LICENSE_KEY:-}" ] && [ -f ../../.env.local ]; then
  line=$(grep -m1 '^DOCUMENT_ENGINE_LICENSE_KEY=' ../../.env.local || true)
  value=${line#DOCUMENT_ENGINE_LICENSE_KEY=}
  # Tolerate either quoting style, since both are valid in a .env file.
  value=${value%\"}
  value=${value#\"}
  value=${value%\'}
  value=${value#\'}
  DOCUMENT_ENGINE_LICENSE_KEY=$value
fi
export DOCUMENT_ENGINE_LICENSE_KEY="${DOCUMENT_ENGINE_LICENSE_KEY:-}"

if [ -n "$DOCUMENT_ENGINE_LICENSE_KEY" ]; then
  echo 'Document Engine: licensed (no evaluation watermark).'
else
  echo 'Document Engine: evaluation mode — watermark, 50 MB input cap, 100 s timeout.'
  echo 'Set DOCUMENT_ENGINE_LICENSE_KEY in .env.local to run licensed.'
fi

if [ "$#" -eq 0 ]; then
  exec docker compose up -d
fi
exec docker compose "$@"

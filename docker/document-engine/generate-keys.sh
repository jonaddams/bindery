#!/usr/bin/env bash
# Generate the RSA keypair Document Engine verifies viewer JWTs against.
#
# The engine gets the public half; the app keeps the private half and signs with
# it. Neither is committed — a keypair is per-checkout, and committing a signing
# key would let every checkout mint sessions for every other.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p secrets
if [ -f secrets/jwt-private.pem ] && [ "${1:-}" != '--force' ]; then
  echo 'secrets/jwt-private.pem already exists; pass --force to replace it.' >&2
  exit 0
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/jwt-private.pem
openssl rsa -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
echo 'Wrote secrets/jwt-private.pem and secrets/jwt-public.pem'

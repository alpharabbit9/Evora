#!/usr/bin/env bash
# One-time setup for the staging rehearsal: random secrets in .env and a throwaway local CA with a
# certificate for Mailpit's STARTTLS. Everything it writes is gitignored and local to this machine.
# Re-running keeps an existing .env (so the database password still matches its volume).
set -euo pipefail
cd "$(dirname "$0")"

rand() { openssl rand -base64 "$1" | tr -d '/+=\n' | cut -c1-"$2"; }

if [[ ! -f .env ]]; then
  {
    echo "POSTGRES_PASSWORD=$(rand 32 32)"
    echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
    echo "S3_ACCESS_KEY_ID=commercecore-$(rand 12 12)"
    echo "S3_SECRET_ACCESS_KEY=$(rand 40 40)"
  } > .env
  echo "Wrote .env with fresh random secrets."
else
  echo "Kept existing .env."
fi

# SeaweedFS S3 identities: the application's key, and anonymous read on the media bucket only
# (product images are public, as they would be behind a CDN).
set -a; source .env; set +a
mkdir -p secrets
cat > secrets/s3.json <<JSON
{
  "identities": [
    {
      "name": "commercecore",
      "credentials": [{ "accessKey": "$S3_ACCESS_KEY_ID", "secretKey": "$S3_SECRET_ACCESS_KEY" }],
      "actions": ["Admin", "Read", "List", "Tagging", "Write"]
    },
    { "name": "anonymous", "actions": ["Read:commercecore-media"] }
  ]
}
JSON
chmod 644 secrets/s3.json

mkdir -p certs
if [[ ! -f certs/mailpit.crt ]]; then
  # MSYS_NO_PATHCONV stops Git Bash on Windows rewriting "/CN=…" into a file path.
  export MSYS_NO_PATHCONV=1
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout certs/ca.key -out certs/ca.crt -subj "/CN=CommerceCore staging rehearsal CA" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout certs/mailpit.key -out certs/mailpit.csr \
    -subj "/CN=mailpit" 2>/dev/null
  printf 'subjectAltName=DNS:mailpit\nextendedKeyUsage=serverAuth\n' > certs/mailpit.ext
  openssl x509 -req -in certs/mailpit.csr -CA certs/ca.crt -CAkey certs/ca.key -CAcreateserial \
    -days 30 -out certs/mailpit.crt -extfile certs/mailpit.ext 2>/dev/null
  rm -f certs/mailpit.csr certs/mailpit.ext certs/ca.srl
  # Containers run as non-root users; the key is a throwaway for a local container.
  chmod 644 certs/*
  echo "Wrote a local CA and a Mailpit certificate to certs/ (valid 30 days)."
fi

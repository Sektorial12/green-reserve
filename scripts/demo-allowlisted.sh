#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DEPOSIT_ID:-}" ]]; then
  if command -v hexdump >/dev/null 2>&1; then
    DEPOSIT_ID="0x$(hexdump -vn 32 -e '/1 "%02x"' /dev/urandom)"
  else
    echo "DEPOSIT_ID is required (export DEPOSIT_ID=0x...)"
    exit 1
  fi
fi

export DEPOSIT_ID

cd "$REPO_ROOT"

./scripts/broadcast.sh
./scripts/verify.sh

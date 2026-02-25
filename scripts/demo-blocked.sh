#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

PAYLOAD_FILE=./workflows/greenreserve-workflow/payloads/deposit-blocked.json \
  ./scripts/dry-run.sh

#!/usr/bin/env bash
# Must-pass pre-publish secret/PII scan (fails closed). See scripts/prepublish_scan.py and PUBLISH-PLAN.md.
#   PREPUBLISH_PERSONAL_RE='<names|handles>' bash scripts/prepublish-scan.sh . /tmp/dnr-agent-public --dir out
exec python3 "$(dirname "$0")/prepublish_scan.py" "$@"

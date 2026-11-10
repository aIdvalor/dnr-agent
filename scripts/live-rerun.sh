#!/usr/bin/env bash
# Free-tier live re-run (the 8:30 AM PT job). Runs the HELD-OUT pack first (20 cases / 34 turns, ~170 requests),
# then the v1 pack with whatever remains of the 500 requests/day quota (it stops cleanly at the daily cap and
# --resume continues the next day). Results and recordings are written to date-tagged files, so the Nov 9 live run
# and the recording the demo replays are never overwritten.
# Needs GOOGLE_GENERATIVE_AI_API_KEY in the environment (never printed). $0: free tier, prices set to 0.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ] || { echo "GOOGLE_GENERATIVE_AI_API_KEY is not set; not running."; exit 2; }
export DNR_MODEL="${DNR_MODEL:-google:gemini-3.1-flash-lite}"
case "$DNR_MODEL" in google:gemini-3.1-flash-lite|google:gemini-2.5-flash) ;; *) echo "refusing non-free-tier model $DNR_MODEL"; exit 2;; esac
export DNR_PRICE_INPUT_PER_MTOK=0 DNR_PRICE_OUTPUT_PER_MTOK=0 DNR_SPEND_CAP_USD=0.01
TAG="${DNR_LIVE_TAG:-$(TZ=America/Los_Angeles date +%F)}"
RESUME=""; [ "${1:-}" = "--resume" ] && RESUME="--resume"
sha256sum -c evals/heldout/SHA256SUMS
echo "[live-rerun] $(date) model=$DNR_MODEL tag=$TAG commit=$(git rev-parse --short HEAD) policy=$(node -p "require('./policy.json').version")"
npx tsx evals/run.ts --live --pack heldout --repeat 1 --tag "$TAG" $RESUME || echo "[live-rerun] heldout exited $?"
npx tsx evals/run.ts --live --pack v1 --repeat 1 --tag "$TAG" $RESUME || echo "[live-rerun] v1 exited $?"
echo "[live-rerun] done: evals/results/live-heldout-$TAG.json, evals/results/live-$TAG.json (v1), recordings in evals/recordings/*-$TAG.jsonl"

#!/usr/bin/env bash
# Full deterministic eval: variance check, both ablations, the v1 gate, the replay gate, the held-out gate, then REPORT.md.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx evals/build-cases.ts
npx tsx evals/run.ts --repeat 3 > /dev/null
cp evals/results/deterministic.json /tmp/dnr-variance.json
npx tsx evals/run.ts --ablation no-tripwire > /dev/null
npx tsx evals/run.ts --ablation no-guards > /dev/null
npx tsx evals/run.ts --gate
node -e "const a=require('/tmp/dnr-variance.json'),f='evals/results/deterministic.json',b=require('./'+f);b.variance=a.variance;b.varianceRepeats=3;require('fs').writeFileSync(f,JSON.stringify(b,null,2))"
npx tsx evals/run.ts --model replay --gate > /dev/null
sha256sum -c evals/heldout/SHA256SUMS
npx tsx evals/run.ts --pack heldout --gate > /dev/null
npx tsx evals/report.ts

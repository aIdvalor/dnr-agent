#!/usr/bin/env bash
# Publishes v2 into the existing public repo aIdvalor/dnr-agent, keeping v1 history. See PUBLISH-PLAN.md.
# Default is a DRY RUN: prepares everything in $WORK and pushes nothing. Pass --push to push (needs the owner's yes).
# Uses existing gh credentials; never prints tokens.
set -euo pipefail
V2="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-/tmp/dnr-publish}"
REPO="aIdvalor/dnr-agent"
PUSH=0; [ "${1:-}" = "--push" ] && PUSH=1
say() { echo "[publish] $*"; }

# 0. Must-pass gates on the exact tree being published.
cd "$V2"
[ -z "$(git status --porcelain)" ] || { say "working tree not clean"; exit 1; }
npm run gate
rm -rf out public/recorded && NEXT_PUBLIC_BASE_PATH=/dnr-agent npm run build && bash scripts/verify-static.sh out

# 1. Fresh clone of the public repo (full history).
rm -rf "$WORK" && git clone -q "https://github.com/$REPO.git" "$WORK/repo"
cd "$WORK/repo"
V1_SHA=$(git rev-parse origin/master)
say "public master (becomes v1): $V1_SHA"

# 2. Import v2 history and make master's tree exactly v2, as a merge that keeps both histories.
git fetch -q "$V2" "HEAD:refs/heads/v2-import"
git checkout -q master
git merge -q --allow-unrelated-histories --no-commit -s ours v2-import
git read-tree -u --reset v2-import
git -c user.name=aIdvalor -c user.email=aIdvalor@users.noreply.github.com commit -q -m "v2: tool-calling DNR agent with deterministic policy, commit-boundary invariants and replay-only static demo

v1 (policy design, autonomy matrix, replayed outputs) is tagged v1. This merge keeps both histories; the tree is v2."
say "new master: $(git rev-parse --short HEAD) (parents: v1 $(git rev-parse --short HEAD^1), v2 $(git rev-parse --short HEAD^2))"

# 3. gh-pages: v2 static export at the root, v1 demo kept at /demo/ (old links) and /v1/demo/.
rm -rf "$WORK/pages" && mkdir -p "$WORK/pages"
cp -r "$V2/out/." "$WORK/pages/"
git -C "$WORK/repo" archive "$V1_SHA" demo | tar -x -C "$WORK/pages"
mkdir -p "$WORK/pages/v1" && cp -r "$WORK/pages/demo" "$WORK/pages/v1/demo"
touch "$WORK/pages/.nojekyll"
bash "$V2/scripts/verify-static.sh" "$WORK/pages"
cd "$WORK/pages" && git init -q -b gh-pages && git add -A && git -c user.name=aIdvalor -c user.email=aIdvalor@users.noreply.github.com commit -q -m "Pages: v2 static replay-only demo (root), v1 demo at /demo and /v1/demo"
cd "$WORK/repo"

# 4. Secret/PII scan of everything that will be public: full history of the new master, and the Pages tree.
bash "$V2/scripts/prepublish-scan.sh" "$WORK/repo" "$WORK/pages" --dir "$WORK/pages"

if [ $PUSH -eq 0 ]; then say "DRY RUN complete. Would push: tag v1 -> $V1_SHA; master -> $(git rev-parse --short HEAD); gh-pages (force, new branch); switch Pages source to gh-pages."; exit 0; fi

# 5. Push: tag first, then master (workflow files may be refused without the workflow scope), then Pages.
git tag -a v1 "$V1_SHA" -m "v1: policy design, autonomy matrix, replayed model outputs (before the v2 tool-calling agent)"
git push origin v1
if ! git push origin master 2>"$WORK/push.err"; then
  if grep -qi "workflow" "$WORK/push.err"; then
    say "push refused for workflow files (token lacks workflow scope): rewriting the import without .github/workflows"
    git reset -q --hard "$V1_SHA"
    git filter-branch -f --index-filter 'git rm -r -q --cached --ignore-unmatch .github/workflows' v2-import >/dev/null
    git merge -q --allow-unrelated-histories --no-commit -s ours v2-import && git read-tree -u --reset v2-import
    git -c user.name=aIdvalor -c user.email=aIdvalor@users.noreply.github.com commit -q -m "v2: tool-calling DNR agent with deterministic policy, commit-boundary invariants and replay-only static demo (CI workflow to follow)"
    bash "$V2/scripts/prepublish-scan.sh" "$WORK/repo"
    git push origin master
    echo "WORKFLOWS_OMITTED=1" > "$WORK/omitted"
  else cat "$WORK/push.err" | sed -E 's#https://[^@ ]*@#https://***@#g'; exit 1; fi
fi
git -C "$WORK/pages" push -q -f "https://github.com/$REPO.git" gh-pages
gh api -X PUT "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
say "pushed. Repo: https://github.com/$REPO  Demo: https://aidvalor.github.io/dnr-agent/  v1: https://github.com/$REPO/tree/v1"

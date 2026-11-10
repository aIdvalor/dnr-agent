# Publish plan: DNR agent v2 → aIdvalor/dnr-agent

Decision (CTO review, Nov 9): keep one canonical repo. Tag the current public `master` as `v1` and make v2 the default content, keeping both histories. Host a **static, replay-only** demo on GitHub Pages. No live model path is public.

Automation: `scripts/publish.sh` does steps 1–6 as a **dry run** by default (prepares `/tmp/dnr-publish`, pushes nothing). `scripts/publish.sh --push` performs the pushes. Run `--push` only with the owner's explicit yes.

## Release conditions (all must pass; if any fails, do not publish)
1. `npm run gate` passes: typecheck; unit tests including commit-boundary invariants (`tests/invariants.test.ts`) and grader self-tests; pack v1 (scripted + adversarial); replay of the live recording; frozen held-out pack after its hash check.
2. The i15 known-miss end-to-end regression and the tripwire-off tests pass (part of 1).
3. The static export verifies clean: `bash scripts/verify-static.sh out` (no `/api` paths, no provider SDK code or endpoints, no key names or key-shaped strings).
4. **Pre-publish secret/PII scan is clean** (must-pass):
   ```bash
   PREPUBLISH_PERSONAL_RE='<owner names / handles regex, kept out of the repo>' \
     bash scripts/prepublish-scan.sh . /tmp/dnr-agent-public --dir out
   ```
   gitleaks (full history of every ref) + trufflehog + a pattern sweep of every blob in every commit and every commit's author/committer email for: email addresses (only `@users.noreply.github.com` allowed), the owner's names/handles, gmail addresses, `AIza…`, `ghp_…`/`github_pat_…`, `sk-…`, private keys. Prints only commit/file/line/rule, never the value. The publish script re-runs it on the merged history and the exact Pages tree.
5. README is honest:
   - the scope statement;
   - the run-accounting table;
   - the t03 incident (failure → root cause → fix → regression → what it does not prove);
   - the tripwire described as a heuristic;
   - limits, including "no fresh live run on the fixed code yet" and "held-out pack is not independent".

## Steps
1. **Gate + build + verify** on a clean tree: `npm run gate`, then `NEXT_PUBLIC_BASE_PATH=/dnr-agent npm run build`, then `bash scripts/verify-static.sh out`.
2. **Clone** `https://github.com/aIdvalor/dnr-agent.git` fresh. Record `origin/master` as the v1 commit.
3. **Merge v2 in, keeping history**:
   ```bash
   git fetch <v2 repo> HEAD:v2-import
   git merge --allow-unrelated-histories --no-commit -s ours v2-import
   git read-tree -u --reset v2-import
   git commit
   ```
   Result: `master`'s tree is exactly v2, and its parents are v1 `master` and the v2 history.
4. **Pages tree**: v2 `out/` at the root. The v1 demo is copied from the v1 commit to `/demo/` (old links keep working) and `/v1/demo/`. Add `.nojekyll`, re-run `verify-static.sh` on it, and commit as an orphan `gh-pages` branch.
5. **Scan** the merged history and the Pages tree with `scripts/prepublish-scan.sh` (step 4 of the release conditions).
6. **Push**, in order:
   1. `git tag -a v1 <v1 sha>`, then `git push origin v1`.
   2. `git push origin master`. If GitHub refuses it because the token lacks the `workflow` scope:
      - rewrite the import without `.github/workflows` (`git filter-branch --index-filter 'git rm -r --cached --ignore-unmatch .github/workflows'` on `v2-import`);
      - redo the merge, re-scan and push;
      - record that the CI workflow was omitted (to be added later by a PR from an account with that scope).
   3. Force-push `gh-pages`.
   4. Switch Pages to the `gh-pages` branch: `gh api -X PUT repos/aIdvalor/dnr-agent/pages -f source[branch]=gh-pages -f source[path]=/`. It is currently "legacy, master /".
7. **Verify live**:
   - `curl -sI` the repo page and `https://aidvalor.github.io/dnr-agent/`, expecting 200.
   - `curl` `recorded/cases.json`, `/demo/` (v1) and `https://github.com/aIdvalor/dnr-agent/tree/v1`.
   - Run `BASE_URL=https://aidvalor.github.io/dnr-agent/ SHOTS_DIR=/tmp/dnr-live-shots npx tsx scripts/smoke-static.ts`. It takes desktop and mobile screenshots and fails if any request leaves `aidvalor.github.io`, so no model or AI-provider calls are made.
   - Re-run `scripts/prepublish-scan.sh` on a fresh clone of the published repo.

## Not public, by design
- The live entry point `scripts/live.ts` and `scripts/live-rerun.sh` are in the repo as source, but they need a local key and never run in the site or in CI.
- The `live-evals` workflow is manual-only and needs a repo secret that is not set.
- Retailer names, personal data and employer details are not in the repo.

## Rollback
- `master` can be reset to the v1 tag: `git push -f origin v1^{commit}:master`.
- Pages can be switched back to `master /`. The v1 demo is still at `/demo/` either way.

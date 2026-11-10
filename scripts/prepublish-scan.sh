#!/usr/bin/env bash
# Must-pass pre-publish secret and PII scan. Never prints a matched value: only where (commit/file/line) and which rule.
# Usage: scripts/prepublish-scan.sh <git-repo>... [--dir <path>]...
#   e.g. scripts/prepublish-scan.sh . /tmp/dnr-agent-public --dir out
# Scans: gitleaks (full git history of every repo, and each --dir), trufflehog (same, if installed),
# and a pattern sweep over every blob reachable from any ref (git grep over rev-list --all) + commit author/committer
# emails + each --dir, for: email addresses, personal names/handles, gmail, Google API keys (AIza…), GitHub tokens,
# OpenAI-style sk- keys. Exits 1 on any finding not in the allowlist below.
set -uo pipefail
PATH="$HOME/bin:/home/box/bin:$PATH"
REPOS=(); DIRS=()
while [ $# -gt 0 ]; do case "$1" in --dir) DIRS+=("$2"); shift 2;; *) REPOS+=("$1"); shift;; esac; done
[ ${#REPOS[@]} -gt 0 ] || REPOS=(.)
FINDINGS=0
note() { echo "FINDING $*"; FINDINGS=$((FINDINGS+1)); }

# Personal identifiers are given as a regex in the environment so this script does not itself contain them.
# Default covers the owner's names/handles as configured in PREPUBLISH_PERSONAL_RE; set it before running.
PERSONAL_RE="${PREPUBLISH_PERSONAL_RE:-}"
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_ALLOW='(@users\.noreply\.github\.com|^noreply@local$|@example\.(com|org)$|^you@example\.com$|^git@github\.com$)'
KEY_RES=('google-api-key:AIza[0-9A-Za-z_-]{35}' 'github-token:(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}' 'github-pat:github_pat_[0-9A-Za-z_]{40,}' 'sk-key:(^|[^A-Za-z0-9])sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}' 'gmail:[A-Za-z0-9._%+-]+@gmail\.com' 'private-key:-----BEGIN [A-Z ]*PRIVATE KEY-----')

sweep_stream() { # $1 label; stdin lines "<where>:<line>:<content>" ; prints location + rule only
  local label="$1"
  python3 -c '
import re,sys,os
label=sys.argv[1]; keys=[k.split(":",1) for k in sys.argv[2].split("\n") if k]
email=re.compile(sys.argv[3]); allow=re.compile(sys.argv[4]); personal=sys.argv[5]
pre=re.compile(personal, re.I) if personal else None
n=0
for raw in sys.stdin:
    raw=raw.rstrip("\n")
    m=re.match(r"^(.*?):(\d+):(.*)$", raw)
    if not m: continue
    where,line,content=m.groups()
    hits=[name for name,rx in keys if re.search(rx,content)]
    for e in email.findall(content):
        if not allow.search(e): hits.append("email-address")
    if pre and pre.search(content): hits.append("personal-identifier")
    for h in sorted(set(hits)):
        print(f"FINDING {label} {where}:{line} rule={h}"); n+=1
sys.exit(1 if n else 0)
' "$label" "$(printf '%s\n' "${KEY_RES[@]}")" "$EMAIL_RE" "$EMAIL_ALLOW" "$PERSONAL_RE"
}

for R in "${REPOS[@]}"; do
  R=$(cd "$R" && pwd); name=$(basename "$R")
  echo "== repo $R ($(git -C "$R" rev-list --all | wc -l | tr -d ' ') commits, all refs)"
  if command -v gitleaks >/dev/null; then
    rep=$(mktemp); gitleaks git "$R" --redact --no-banner --log-level error --report-format json --report-path "$rep" >/dev/null 2>&1
    c=$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));[print(f"FINDING gitleaks {x[\"Commit\"][:8]} {x[\"File\"]}:{x[\"StartLine\"]} rule={x[\"RuleID\"]}") for x in d];print(len(d),file=sys.stderr)' "$rep" 2>/tmp/glc); cnt=$(cat /tmp/glc)
    [ -n "$c" ] && echo "$c"; FINDINGS=$((FINDINGS+cnt)); echo "gitleaks git: $cnt"; rm -f "$rep"
  else echo "gitleaks not installed"; FINDINGS=$((FINDINGS+1)); fi
  if command -v trufflehog >/dev/null; then
    t=$(trufflehog git "file://$R" --no-update --json 2>/dev/null | python3 -c '
import json,sys
n=0
for l in sys.stdin:
    try: x=json.loads(l)
    except Exception: continue
    g=x.get("SourceMetadata",{}).get("Data",{}).get("Git",{})
    print(f"FINDING trufflehog {g.get(\"commit\",\"\")[:8]} {g.get(\"file\")}:{g.get(\"line\")} rule={x.get(\"DetectorName\")} verified={x.get(\"Verified\")}"); n+=1
print(n, file=sys.stderr)' 2>/tmp/thc); cnt=$(cat /tmp/thc)
    [ -n "$t" ] && echo "$t"; FINDINGS=$((FINDINGS+cnt)); echo "trufflehog git: $cnt"
  else echo "trufflehog not installed (optional)"; fi
  # Pattern sweep over every blob in every commit reachable from any ref.
  revs=$(git -C "$R" rev-list --all)
  out=$(for rev in $revs; do git -C "$R" grep -I -n -E -e '@' -e 'AIza' -e '_[0-9A-Za-z]{36}' -e 'sk-' -e 'PRIVATE KEY' ${PERSONAL_RE:+-e "$PERSONAL_RE" -i} "$rev" 2>/dev/null; done | sed -E 's/^([0-9a-f]{8})[0-9a-f]*:/\1:/' | sort -u | sweep_stream "history:$name")
  c=$(printf '%s\n' "$out" | grep -c '^FINDING' || true)
  # dedupe the same file:line:rule across commits, keep first commit
  [ -n "$out" ] && printf '%s\n' "$out" | awk '{split($3,a,":"); k=a[2]":"a[3]" "$4; if(!(k in s)){s[k]=1; print}}'
  FINDINGS=$((FINDINGS+c)); echo "history pattern sweep: $c raw hits"
  meta=$(git -C "$R" log --all --format='%H %ae%n%H %ce' | sort -u | while read -r h e; do if ! printf '%s' "$e" | grep -qE "$EMAIL_ALLOW"; then echo "FINDING commit-metadata ${h:0:8} rule=non-noreply-email"; fi; if [ -n "$PERSONAL_RE" ] && git -C "$R" log -1 --format='%an %cn %B' "$h" | grep -qiE "$PERSONAL_RE"; then echo "FINDING commit-metadata ${h:0:8} rule=personal-identifier"; fi; done | sort -u)
  [ -n "$meta" ] && echo "$meta"; c=$(printf '%s' "$meta" | grep -c '^FINDING' || true); FINDINGS=$((FINDINGS+c)); echo "commit metadata: $c"
done

for D in "${DIRS[@]}"; do
  D=$(cd "$D" && pwd); echo "== dir $D ($(find "$D" -type f | wc -l | tr -d ' ') files)"
  if command -v gitleaks >/dev/null; then
    rep=$(mktemp); gitleaks dir "$D" --redact --no-banner --log-level error --report-format json --report-path "$rep" >/dev/null 2>&1
    c=$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));[print(f"FINDING gitleaks {x[\"File\"]}:{x[\"StartLine\"]} rule={x[\"RuleID\"]}") for x in d];print(len(d),file=sys.stderr)' "$rep" 2>/tmp/glc); cnt=$(cat /tmp/glc)
    [ -n "$c" ] && echo "$c"; FINDINGS=$((FINDINGS+cnt)); echo "gitleaks dir: $cnt"; rm -f "$rep"
  fi
  if command -v trufflehog >/dev/null; then
    cnt=$(trufflehog filesystem "$D" --no-update --json 2>/dev/null | grep -c '"DetectorName"' || true); echo "trufflehog filesystem: $cnt"; FINDINGS=$((FINDINGS+cnt))
  fi
  out=$(grep -rInE -e '@' -e 'AIza' -e '_[0-9A-Za-z]{36}' -e 'sk-' -e 'PRIVATE KEY' ${PERSONAL_RE:+-e "$PERSONAL_RE" -i} "$D" 2>/dev/null | sweep_stream "dir")
  [ -n "$out" ] && printf '%s\n' "$out"; c=$(printf '%s' "$out" | grep -c '^FINDING' || true); FINDINGS=$((FINDINGS+c)); echo "dir pattern sweep: $c"
done
echo; if [ "$FINDINGS" -eq 0 ]; then echo "PREPUBLISH SCAN: CLEAN"; exit 0; else echo "PREPUBLISH SCAN: $FINDINGS finding(s). Do not publish until each is fixed or explicitly allowlisted."; exit 1; fi

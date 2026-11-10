#!/usr/bin/env python3
"""Must-pass pre-publish secret and PII scan. FAILS CLOSED: any scanner error counts as a finding.
Never prints a matched value: only where (commit / file / line) and which rule.

usage: prepublish_scan.py <git-repo>... [--dir <path>]... [--md <report.md>]
Personal names/handles come from PREPUBLISH_PERSONAL_RE (kept out of the repo on purpose).
"""
import json, os, re, shutil, subprocess, sys, tempfile

args = sys.argv[1:]; repos, dirs, md = [], [], None
while args:
    a = args.pop(0)
    if a == '--dir': dirs.append(args.pop(0))
    elif a == '--md': md = args.pop(0)
    else: repos.append(a)
repos = repos or ['.']
for b in ('/home/box/bin', os.path.expanduser('~/bin')):
    os.environ['PATH'] = b + ':' + os.environ['PATH']

PERSONAL = os.environ.get('PREPUBLISH_PERSONAL_RE', '')
RULES = [
    ('google-api-key', re.compile(r'AIza[0-9A-Za-z_\-]{35}')),
    ('github-token', re.compile(r'\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b')),
    ('github-pat', re.compile(r'github_pat_[0-9A-Za-z_]{40,}')),
    ('sk-key', re.compile(r'(?<![A-Za-z0-9])sk-(proj-|ant-)?[A-Za-z0-9_\-]{20,}')),
    ('gmail-address', re.compile(r'[A-Za-z0-9._%+\-]+@gmail\.com', re.I)),
    ('private-key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
]
if PERSONAL: RULES.append(('personal-identifier', re.compile(PERSONAL, re.I)))
EMAIL = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}')
EMAIL_ALLOW = re.compile(r'(@users\.noreply\.github\.com$|^noreply@local$|@example\.(com|org)$|^git@github\.com$)', re.I)

import hashlib
findings, log, allowed = [], [], []
# Narrow allowlist (owner decision, Nov 9 2026): identifiers that are already public in v1 history and intentional.
# Entries are exact: a commit sha + rule, or a path + rule + sha256 of the exact line text. No names are stored here.
ALLOW_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepublish-allowlist.json')
ALLOW = json.load(open(ALLOW_FILE)) if os.path.exists(ALLOW_FILE) else {'commits': [], 'lines': []}
def is_allowed(rule, commit=None, path=None, linehash=None):
    if commit and any(commit == a['commit'] and rule == a['rule'] for a in ALLOW['commits']): return True
    if path and linehash and any(path == a['path'] and rule == a['rule'] and linehash == a['sha256'] for a in ALLOW['lines']): return True
    return False
def F(scope, where, rule, commit=None, path=None, linehash=None):
    (allowed if is_allowed(rule, commit, path, linehash) else findings).append((scope, where, rule))
def say(s): log.append(s); print(s)

def scan_text(scope, where, text, path=None):
    for i, line in enumerate(text.splitlines(), 1):
        lh = hashlib.sha256(line.encode()).hexdigest()
        if len(line) > 20000: line = line[:20000]
        hit = {name for name, rx in RULES if rx.search(line)}
        for m in EMAIL.finditer(line):
            if not EMAIL_ALLOW.search(m.group(0)): hit.add('email-address')
        for h in sorted(hit): F(scope, f'{where}:{i}', h, path=path, linehash=lh)

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def gitleaks(scope, mode, target):
    if not shutil.which('gitleaks'): F(scope, '-', 'gitleaks-not-installed'); return
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as t: rp = t.name
    r = run(['gitleaks', mode, target, '--redact', '--no-banner', '--log-level', 'error', '--report-format', 'json', '--report-path', rp, '--exit-code', '0'])
    try: d = json.load(open(rp))
    except Exception: F(scope, '-', f'gitleaks-error rc={r.returncode}'); return
    for x in d: F(scope, f"{x.get('Commit','')[:8]} {x.get('File')}:{x.get('StartLine')}".strip(), f"gitleaks:{x.get('RuleID')}")
    say(f'  gitleaks {mode}: {len(d)}')

def trufflehog(scope, mode, target):
    if not shutil.which('trufflehog'): say('  trufflehog: not installed (optional)'); return
    r = run(['trufflehog', mode, target, '--no-update', '--json'])
    if r.returncode not in (0, 183): F(scope, '-', f'trufflehog-error rc={r.returncode}'); return
    n = 0
    for l in r.stdout.splitlines():
        try: x = json.loads(l)
        except Exception: continue
        if 'DetectorName' not in x: continue
        md_ = x.get('SourceMetadata', {}).get('Data', {}); g = md_.get('Git') or md_.get('Filesystem') or {}
        F(scope, f"{str(g.get('commit',''))[:8]} {g.get('file')}:{g.get('line')}".strip(), f"trufflehog:{x['DetectorName']}{' VERIFIED' if x.get('Verified') else ''}"); n += 1
    say(f'  trufflehog {mode}: {n}')

for R in repos:
    R = os.path.abspath(R); name = os.path.basename(R.rstrip('/'))
    revs = run(['git', '-C', R, 'rev-list', '--all']).stdout.split()
    if not revs: F(name, '-', 'not-a-git-repo-or-empty'); continue
    say(f'== repo {R}: {len(revs)} commits (all refs)')
    gitleaks(f'repo:{name}', 'git', R)
    trufflehog(f'repo:{name}', 'git', 'file://' + R)
    # every blob reachable from any commit, scanned once per blob id
    seen, blobs = set(), 0
    before = len(findings)
    for rev in revs:
        for ent in run(['git', '-C', R, 'ls-tree', '-r', rev]).stdout.splitlines():
            meta, path = ent.split('\t', 1); _, typ, sha = meta.split()
            if typ != 'blob' or sha in seen: continue
            seen.add(sha); blobs += 1
            data = subprocess.run(['git', '-C', R, 'cat-file', 'blob', sha], capture_output=True).stdout
            if b'\0' in data[:8000]: continue
            scan_text(f'history:{name}', f'{rev[:8]} {path}', data.decode('utf-8', 'replace'), path=path)
    say(f'  pattern sweep: {blobs} unique text/binary blobs, {len(findings)-before} hits')
    before = len(findings)
    for l in run(['git', '-C', R, 'log', '--all', '--format=%H%x09%an%x09%ae%x09%cn%x09%ce%x09%s%x09%b']).stdout.split('\n'):
        p = l.split('\t')
        if len(p) < 6: continue
        full = p[0]; h = full[:8]
        for e in (p[2], p[4]):
            if e and not EMAIL_ALLOW.search(e): F(f'meta:{name}', h, 'commit-email-not-noreply', commit=full)
        body = '\t'.join([p[1], p[3]] + p[5:])
        for nm, rx in RULES:
            if rx.search(body): F(f'meta:{name}', h, f'commit-message:{nm}', commit=full)
    say(f'  commit metadata (author/committer/message): {len(findings)-before} hits')

for D in dirs:
    D = os.path.abspath(D); files = 0; before = len(findings)
    say(f'== dir {D}')
    gitleaks(f'dir:{os.path.basename(D)}', 'dir', D)
    trufflehog(f'dir:{os.path.basename(D)}', 'filesystem', D)
    for root, _, fs in os.walk(D):
        for f in fs:
            p = os.path.join(root, f); files += 1
            try: data = open(p, 'rb').read()
            except Exception: F('dir', p, 'unreadable'); continue
            if b'\0' in data[:8000]: continue
            scan_text('dir', os.path.relpath(p, D), data.decode('utf-8', 'replace'), path=os.path.relpath(p, D))
    say(f'  pattern sweep: {files} files, {len(findings)-before} hits')

uniq = sorted(set(findings))
for s_, w_, r_ in sorted(set(allowed)): print(f'ALLOWLISTED {s_} {w_} rule={r_}')
say(f'allowlisted (exact, pre-existing public): {len(set(allowed))}')
for s, w, r in uniq: print(f'FINDING {s} {w} rule={r}')
verdict = 'CLEAN' if not uniq else f'{len(uniq)} finding(s): DO NOT PUBLISH until each is fixed or explicitly allowlisted'
print(f'\nPREPUBLISH SCAN: {verdict}')
if md:
    with open(md, 'w') as fh:
        fh.write('\n'.join(log) + '\n\n' + '\n'.join(f'- `{s}` `{w}` rule `{r}`' for s, w, r in uniq) + f'\n\n**Verdict: {verdict}**\n')
sys.exit(0 if not uniq else 1)

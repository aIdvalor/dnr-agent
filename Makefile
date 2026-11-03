.PHONY: cases baseline score gate
cases:    ; python3 evals/generate_cases.py
baseline: ; python3 baseline.py
score: baseline ; python3 evals/score.py > evals/baseline_report.md && cat evals/baseline_report.md
gate:     ; python3 evals/gate.py

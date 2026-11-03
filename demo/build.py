"""Run the 3 scenarios (replay by default) and write a single static demo/index.html."""
import json, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from agent import workflow
data = workflow.run_all()
(ROOT / "demo/traces.json").write_text(json.dumps(data, indent=1))
html = (ROOT / "demo/template.html").read_text().replace("/*DATA*/null", json.dumps(data))
(ROOT / "demo/index.html").write_text(html); print("wrote demo/index.html")

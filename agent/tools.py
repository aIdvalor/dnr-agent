"""Mock read-only tools over JSON fixtures. Money tools are not here: only the workflow can call them after the policy engine allows it."""
import json, pathlib
F = json.load(open(pathlib.Path(__file__).with_name("fixtures.json")))
def get_order(oid): return dict(F["orders"][oid])
def get_carrier_events(oid): return dict(F["carrier"][oid])
def get_buyer_history(bid): return dict(F["buyers"][bid])

#!/usr/bin/env python3
"""Regenerate the A04 reader parity fixture from the frozen guild-stack contracts.

Usage: python3 generate-parity.py --contracts-root <umbrella>/contracts/guild-stack [--check]
Needs jsonschema[format]==4.25.1 and rfc8785==0.1.4 (contracts v2 requirements-test.txt).
Reads contract bytes only; never writes under --contracts-root.
"""
import argparse, copy, hashlib, importlib.util, json, sys
from pathlib import Path

sys.dont_write_bytecode = True
OUT = Path(__file__).resolve().parent / "parity.generated.json"
SOURCES = ["v2/contract-bundle.json", "v2/fixtures/cases.json", "v2/fixtures/regressions.json",
           "v2/fixtures/golden.json", "v2/verify_contracts.py", "v1/contract-bundle.json", "v1/fixtures/cases.json", "v1/verify_contracts.py"]


def build(root: Path) -> str:
    def oracle(major):
        spec = importlib.util.spec_from_file_location("verify_contracts_" + major, root / major / "verify_contracts.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    v, v1o = oracle("v2"), oracle("v1")

    def row(origin, cid, schema, instance):
        shape = v.schema_errors(schema, instance)
        out = {"id": cid, "origin": origin, "schema": schema, "schema_valid": not shape, "semantic_errors": [], "instance": instance}
        if not shape:
            try:
                out["semantic_errors"] = v.semantic_errors(schema, instance)
            except Exception as e:  # the oracle cannot evaluate it; the reader must refuse
                out["semantic_errors"], out["oracle_exception"] = [type(e).__name__], True
        return out

    load = lambda rel: json.loads((root / rel).read_text())
    rows = [row("cases", c["id"], c["schema"], c["instance"]) for c in load("v2/fixtures/cases.json")]
    rows += [row("regressions", c["id"], c["schema"], c["instance"]) for c in load("v2/fixtures/regressions.json")["cases"]]
    for gf in load("v2/fixtures/golden.json")["fixtures"]:
        rows += [row("golden-document", gf["id"] + "." + d["id"], d["schema"], d["instance"]) for d in gf["documents"]]
        rows += [row("golden-refusal", r["id"], r["schema"], r["instance"]) for r in gf["refusals"]]
    # A04 edge rows: mutations of frozen fixtures where JS and Python semantics can diverge.
    cases = load("v2/fixtures/cases.json")
    seg = copy.deepcopy(next(c for c in cases if c["id"] == "execution-segment-valid")["instance"])
    for i, (start, end) in enumerate([("2026-10-26T00:00:00.000900Z", "2026-10-26T00:00:00.000100Z"),
                                      ("2026-10-26T00:00:00.000100Z", "2026-10-26T00:00:00.000900Z"),
                                      ("2026-10-26T00:00:00.0000009Z", "2026-10-26T00:00:00.0000001Z")]):
        doc = copy.deepcopy(seg); doc["interval"]["start"], doc["interval"]["end"] = start, end
        rows.append(row("a04-edge", "submillisecond-interval-" + str(i), "execution-segment", doc))
    session = next(c for c in cases if c["id"] == "scope-session-valid")["instance"]
    for i, stamp in enumerate(["2026-10-26 00:00:00Z", "2026-12-31T23:59:60Z", "2026-10-26t00:00:00z", "0000-10-26T00:00:00Z",
                               "2026-02-30T00:00:00Z", "2024-02-29T00:00:00Z", "2026-10-26T24:00:00Z",
                               "2026-10-26T00:00:00.123456789Z", "2026-10-26T00:00:00+24:00", "2026-10-26T00:00:00-00:00",
                               "2026-10-26T00:00:00Z\n"]):
        doc = copy.deepcopy(session); doc["expires_at"] = stamp
        rows.append(row("a04-edge", "date-time-" + str(i), "scope-session", doc))
    for i, start in enumerate(["0000-10-26T00:00:00Z", "2026-10-26t00:00:00z"]):
        doc = copy.deepcopy(seg); doc["interval"]["start"] = start
        rows.append(row("a04-edge", "interval-start-" + str(i), "execution-segment", doc))
    v1_rows = []
    approval = next(c for c in load("v1/fixtures/cases.json") if c["contract"] == "approval-record" and c["valid"])
    for i, rationale in enumerate(["\u0085", "\u001c", "\u00a0\u3000", "\ufeff", "ok\u0085"]):
        doc = copy.deepcopy(approval["instance"]); doc["decision"], doc["rationale"] = "rejected", rationale
        v1_rows.append({"id": "a04-edge-rationale-" + str(i), "contract": "approval-record", "instance": doc})
    v1 = []
    for c in load("v1/fixtures/cases.json") + v1_rows:
        shape = v1o.schema_errors(c["contract"], c["instance"])
        sem = [] if shape else v1o.semantic_errors(c["contract"], c["instance"])
        v1.append({"id": c["id"], "contract": c["contract"], "valid": c.get("valid", not shape and not sem), "schema_valid": not shape,
                   "semantic_errors": [] if shape else v1o.semantic_errors(c["contract"], c["instance"]), "instance": c["instance"]})
    import re
    import rfc3987
    uri_pattern = re.sub(r"\(\?P<[^>]+>", "(?:", rfc3987.get_compiled_pattern("^%(URI)s$").pattern)
    manifest = next(c for c in cases if c["id"] == "capability-manifest-valid")["instance"]
    for i, uri in enumerate(["http://e:xample.com/", "a:", "https://x/ y", "https://x/%zz", "https://x/\u00e9", "https://[::1]/",
                             "https://x:99999/", "1a:b", "https://x/#a#b", "https://x/?q=|", "urn:x:y", "HTTPS://X/Y",
                             "https://x/{a}", "https://user@x:80/p?q#f", "http://[v1.x]/", "http://a/b\n",
                             "https://[1:2::3:4:5:6]/", "https://[1::2]/", "https://[1:2:3:4:5:6::7]/", "https://[::ffff:1.2.3.4]/",
                             "https://[1:{,2}2::3:4:5:6]/", "https://[1{,5}::2]/", "https://[1:2:3:4:5:6:7:8:9]/", "https://[1::2::3]/"]):
        doc = copy.deepcopy(manifest); doc["supported_contracts"][0]["schema_id"] = uri
        rows.append(row("a04-edge", "uri-" + str(i), "capability-manifest", doc))
    doc = {"schema_version": "guild.stack.reader_parity_fixture.v1",
           "uri_pattern": uri_pattern,
           "generated_by": "tests/fixtures/stack-contract-reader/generate-parity.py",
           "oracle": "contracts/guild-stack/{v1,v2}/verify_contracts.py (schema_errors, semantic_errors)",
           "sources": {rel: "sha256:" + hashlib.sha256((root / rel).read_bytes()).hexdigest() for rel in SOURCES},
           "v2": rows, "v1": v1}
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--contracts-root", type=Path, required=True)
    p.add_argument("--check", action="store_true")
    a = p.parse_args()
    data = build(a.contracts_root.resolve())
    if a.check:
        if not OUT.exists() or OUT.read_text() != data:
            raise SystemExit("parity fixture drift: rerun without --check")
        print("parity fixture matches frozen contracts")
    else:
        OUT.write_text(data)
        print("wrote " + str(OUT))


if __name__ == "__main__":
    main()

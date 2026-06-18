#!/usr/bin/env python3
"""
Sampada CAS parser sidecar.

Reads a CDSL/NSDL/CAMS/KFintech Consolidated Account Statement (CAS) PDF using the
open-source `casparser` library and prints a NORMALIZED JSON contract on stdout:

  { "ok": true,
    "fileType": "CAMS|KARVY|NSDL|CDSL",
    "investor": { "name": "..." },
    "mutualFunds": [ {amfi, isin, name, amc, folio, units, nav, value, cost, avgCost} ],
    "stocks":      [ {isin, name, quantity, nav, value, cost, avgCost} ] }

On any failure it prints { "ok": false, "error": "...", "errorType": "..." } and
exits 0 (the error is part of the contract; the Node caller reads stdout).

Usage:
  parse_cas.py <input.pdf> [--password PWD]
  parse_cas.py --self-test           # emits sample normalized data (no PDF needed)
"""
import argparse
import json
import sys
import traceback


# casparser returns a dict (0.7.x) or a pydantic CASData object (1.x) — normalise both.
def _to_dict(raw):
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        return json.loads(raw)
    if hasattr(raw, "model_dump"):  # pydantic v2
        return raw.model_dump(mode="json")
    if hasattr(raw, "dict"):  # pydantic v1
        return raw.dict()
    raise TypeError("Unexpected casparser return type: " + type(raw).__name__)


def _num(x):
    try:
        if x is None:
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def normalize(data):
    """Map raw casparser dict output → Sampada's import contract."""
    out = {
        "ok": True,
        "fileType": data.get("file_type"),
        "casType": data.get("cas_type"),
        "statementPeriod": data.get("statement_period"),
        "investor": {"name": (data.get("investor_info") or {}).get("name")},
        "mutualFunds": [],
        "stocks": [],
    }

    # --- Mutual funds: folios[].schemes[] (all casparser versions) ---
    for folio in data.get("folios") or []:
        amc = folio.get("amc")
        folio_no = folio.get("folio")
        for s in folio.get("schemes") or []:
            val = s.get("valuation") or {}
            units = _num(s.get("close"))
            if units is None:
                units = _num(s.get("close_calculated"))
            nav = _num(val.get("nav"))
            value = _num(val.get("value"))
            cost = _num(val.get("cost"))
            avg_cost = (cost / units) if (cost and units) else nav
            out["mutualFunds"].append({
                "amfi": s.get("amfi"),
                "isin": s.get("isin"),
                "name": s.get("scheme"),
                "amc": amc,
                "folio": folio_no,
                "units": units,
                "nav": nav,
                "value": value,
                "cost": cost,
                "avgCost": avg_cost,
                "schemeType": s.get("type"),
            })

    # --- Equities from demat CAS (casparser >= 1.x; absent on 0.7.4) ---
    # Shape varies across casparser versions, so probe a few likely locations.
    for acc in data.get("demat_accounts") or []:
        buckets = []
        holdings = acc.get("holdings")
        if isinstance(holdings, dict):
            buckets += holdings.get("equities") or []
        buckets += acc.get("equities") or []
        for h in buckets:
            qty = _num(h.get("units")) or _num(h.get("quantity"))
            nav = _num(h.get("nav")) or _num(h.get("price"))
            value = _num(h.get("value"))
            cost = _num(h.get("cost"))
            avg_cost = (cost / qty) if (cost and qty) else nav
            out["stocks"].append({
                "isin": h.get("isin"),
                "name": h.get("name") or h.get("company"),
                "quantity": qty,
                "nav": nav,
                "value": value,
                "cost": cost,
                "avgCost": avg_cost,
            })

    out["counts"] = {"mutualFunds": len(out["mutualFunds"]), "stocks": len(out["stocks"])}
    return out


def self_test():
    """A representative raw-casparser-shaped payload, run through normalize()."""
    sample = {
        "file_type": "CAMS",
        "cas_type": "DETAILED",
        "statement_period": {"from": "2024-04-01", "to": "2026-06-18"},
        "investor_info": {"name": "Ravi Chandra"},
        "folios": [
            {"folio": "12345678/90", "amc": "Axis Mutual Fund", "schemes": [
                {"scheme": "Axis ELSS Tax Saver Fund - Direct Plan - Growth",
                 "isin": "INF846K01EW2", "amfi": "120503", "type": "EQUITY",
                 "close": 850.123,
                 "valuation": {"date": "2026-06-18", "nav": 107.53, "value": 91408.7, "cost": 46750.0}},
            ]},
            {"folio": "9988776655", "amc": "Parag Parikh Mutual Fund", "schemes": [
                {"scheme": "Parag Parikh Flexi Cap Fund - Direct - Growth",
                 "isin": "INF879O01027", "amfi": "122639", "type": "EQUITY",
                 "close": 400.0,
                 "valuation": {"date": "2026-06-18", "nav": 82.15, "value": 32860.0, "cost": 25000.0}},
            ]},
        ],
        # demat block as casparser 1.x would provide (proves the equity path end-to-end)
        "demat_accounts": [
            {"dp_name": "Zerodha", "holdings": {"equities": [
                {"isin": "INE002A01018", "name": "RELIANCE INDUSTRIES LTD",
                 "units": 40, "nav": 1324.7, "value": 52988.0, "cost": 48000.0},
            ]}},
        ],
    }
    return normalize(sample)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", help="CAS PDF path")
    ap.add_argument("--password", default="", help="PDF password")
    ap.add_argument("--self-test", action="store_true", help="emit sample data, no PDF")
    args = ap.parse_args()

    if args.self_test:
        print(json.dumps(self_test()))
        return

    if not args.input:
        print(json.dumps({"ok": False, "error": "No input file given", "errorType": "usage"}))
        return

    try:
        import casparser
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"casparser not installed: {e}",
                          "errorType": "not_installed"}))
        return

    version = getattr(casparser, "__version__", "?")
    try:
        # Call the DEFAULT API (no output= kwarg): works on casparser 0.7.x (returns
        # a dict) and 1.x (returns a CASData object), then coerce to a dict.
        data = _to_dict(casparser.read_cas_pdf(args.input, args.password))
        result = normalize(data)
        result["casparser"] = version
        if result["counts"]["mutualFunds"] == 0 and result["counts"]["stocks"] == 0:
            result["warning"] = "Parsed the file but found no holdings."
            # Help diagnose unrecognised structures (e.g. a demat layout we don't map yet).
            result["debug"] = {
                "fileType": data.get("file_type") or data.get("cas_type"),
                "topKeys": sorted(list(data.keys()))[:20],
            }
        print(json.dumps(result))
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        low = msg.lower()
        etype = "parse_error"
        if any(k in low for k in ("password", "decrypt", "encrypted", "pdfpassword")):
            etype = "bad_password"
        elif any(k in low for k in ("not a valid", "unsupported", "no startxref", "not a cas")):
            etype = "unsupported_file"
        print(json.dumps({
            "ok": False, "error": msg, "errorType": etype,
            "casparser": version, "trace": traceback.format_exc()[-700:],
        }))


if __name__ == "__main__":
    main()

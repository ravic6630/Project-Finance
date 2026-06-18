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


class ParseFailed(Exception):
    def __init__(self, message, where=None, all_errors=None, trace=None):
        super().__init__(message)
        self.where = where
        self.all_errors = all_errors
        self.trace = trace


def _casparser_frame(exc):
    # Find the deepest traceback frame inside the casparser package (file:line in func).
    import os
    try:
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if "casparser" in (f.filename or "")]
        if frames:
            f = frames[-1]
            return f"{os.path.basename(f.filename)}:{f.lineno} in {f.name}()"
    except Exception:  # noqa: BLE001
        pass
    return None


def read_cas_any(casparser, path, password):
    # Some statements break one parse path but parse fine via another (different PDF
    # text backend / transaction handling). Try a few before giving up.
    strategies = [
        {},
        {"force_pdfminer": True},
        {"sort_transactions": False},
        {"force_pdfminer": True, "sort_transactions": False},
    ]
    errors = []
    first = None
    for opts in strategies:
        try:
            return _to_dict(casparser.read_cas_pdf(path, password, **opts)), opts
        except Exception as e:  # noqa: BLE001
            where = _casparser_frame(e)
            errors.append(f"[{opts or 'default'}] {type(e).__name__}: {e}" + (f" @ {where}" if where else ""))
            if first is None:
                first = (str(e), where, traceback.format_exc())
    msg, where, tr = first or ("parse failed", None, "")
    raise ParseFailed(msg, where=where, all_errors=" || ".join(errors), trace=tr)


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

    mfs = out["mutualFunds"]
    stocks = out["stocks"]

    def add_scheme(s, amc=None, folio=None):
        # RTA folio scheme (CAMS/KFintech): scheme, amfi, isin, close, valuation{nav,value,cost}
        val = s.get("valuation") or {}
        units = _num(s.get("close"))
        if units is None:
            units = _num(s.get("close_calculated"))
        nav = _num(val.get("nav"))
        value = _num(val.get("value"))
        cost = _num(val.get("cost"))
        avg = (cost / units) if (cost and units) else nav
        mfs.append({
            "amfi": s.get("amfi"), "isin": s.get("isin"), "name": s.get("scheme"),
            "amc": amc, "folio": folio or s.get("folio"), "units": units,
            "nav": nav, "value": value, "cost": cost, "avgCost": avg,
            "schemeType": s.get("type"),
        })

    def add_demat_mf(m):
        # MF held in demat (NSDL/CDSL): name, isin, amfi, balance, nav, value, avg_cost, total_cost, folio
        units = _num(m.get("balance"))
        nav = _num(m.get("nav"))
        value = _num(m.get("value"))
        cost = _num(m.get("total_cost"))
        avg = _num(m.get("avg_cost"))
        if avg is None:
            avg = (cost / units) if (cost and units) else nav
        mfs.append({
            "amfi": m.get("amfi"), "isin": m.get("isin"), "name": m.get("name"),
            "folio": m.get("folio"), "units": units, "nav": nav, "value": value,
            "cost": cost, "avgCost": avg,
        })

    def add_equity(e):
        # Equity in demat (NSDL/CDSL): name, isin, num_shares, price, value, symbol, exchange
        qty = _num(e.get("num_shares"))
        if qty is None:
            qty = _num(e.get("units")) or _num(e.get("quantity"))
        price = _num(e.get("price")) or _num(e.get("nav"))
        stocks.append({
            "isin": e.get("isin"), "name": e.get("name") or e.get("company"),
            "symbol": e.get("symbol"), "exchange": e.get("exchange"),
            "quantity": qty, "nav": price, "value": _num(e.get("value")),
            "cost": None, "avgCost": price,
        })

    # Mutual-fund (RTA) statement: top-level folios[].schemes[]
    for folio in data.get("folios") or []:
        for s in folio.get("schemes") or []:
            add_scheme(s, folio.get("amc"), folio.get("folio"))

    # Demat statement (NSDL/CDSL): accounts[] with equities / mutual_funds / folios
    for acc in data.get("accounts") or []:
        for e in acc.get("equities") or []:
            add_equity(e)
        for m in acc.get("mutual_funds") or []:
            add_demat_mf(m)
        for folio in acc.get("folios") or []:
            for s in folio.get("schemes") or []:
                add_scheme(s, folio.get("amc"), folio.get("folio"))

    # Legacy/alternate demat shape (harmless if absent)
    for acc in data.get("demat_accounts") or []:
        for e in ((acc.get("holdings") or {}).get("equities") or acc.get("equities") or []):
            add_equity(e)

    out["counts"] = {"mutualFunds": len(mfs), "stocks": len(stocks)}
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
        # Demat block matching casparser 1.x NSDLCASData.accounts (CDSL/NSDL).
        "accounts": [
            {
                "name": "CDSL Demat", "dp_id": "12081600", "client_id": "XXXXXXXX",
                "equities": [
                    {"name": "RELIANCE INDUSTRIES LTD", "isin": "INE002A01018",
                     "symbol": "RELIANCE", "exchange": "NSE", "num_shares": 40,
                     "price": 1324.7, "value": 52988.0},
                ],
                "mutual_funds": [
                    {"name": "Nippon India ETF Nifty 50 BeES", "isin": "INF204KB14I2",
                     "amfi": "120716", "balance": 200, "nav": 285.4, "value": 57080.0,
                     "avg_cost": 250.0, "total_cost": 50000.0, "folio": "DEMAT"},
                ],
            },
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
        data, used = read_cas_any(casparser, args.input, args.password)
        result = normalize(data)
        result["casparser"] = version
        if result["counts"]["mutualFunds"] == 0 and result["counts"]["stocks"] == 0:
            result["warning"] = "Parsed the file but found no holdings."
            result["debug"] = {
                "fileType": data.get("file_type") or data.get("cas_type"),
                "topKeys": sorted(list(data.keys()))[:20],
                "strategy": used,
            }
        print(json.dumps(result))
    except ParseFailed as e:
        msg = str(e)
        low = (e.all_errors or msg).lower()
        etype = "parse_error"
        if any(k in low for k in ("password", "decrypt", "encrypted", "pdfpassword")):
            etype = "bad_password"
        elif any(k in low for k in ("not a valid", "unsupported", "no startxref", "not a cas", "unable to parse investor")):
            etype = "unsupported_file"
        print(json.dumps({
            "ok": False, "error": msg, "errorType": etype, "casparser": version,
            "where": e.where, "allErrors": (e.all_errors or "")[-400:],
            "trace": (e.trace or "")[-700:],
        }))
    except Exception as e:  # noqa: BLE001 — safety net
        print(json.dumps({
            "ok": False, "error": str(e), "errorType": "sidecar_error",
            "casparser": version, "trace": traceback.format_exc()[-700:],
        }))


if __name__ == "__main__":
    main()

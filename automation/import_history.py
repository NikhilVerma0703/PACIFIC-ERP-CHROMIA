#!/usr/bin/env python3
"""
Teach the system from your EXISTING Tally history.

    python import_history.py --file "daybook.xlsx"      from a Tally export
    python import_history.py --tally                    straight from Tally
    python import_history.py --file d.xlsx --dry-run    preview, change nothing

WHY THIS IS THE BIGGEST FREE WIN AVAILABLE
------------------------------------------
The classifier's strongest signal is history: "this vendor went to this ledger
before", "this person claims fuel". Out of the box those tables are empty, so
the first few hundred bills get coded by text similarity alone - which is the
weakest signal - and the team has to correct almost everything.

But PESPL already has years of this knowledge sitting in Tally. Every past
Journal voucher is a labelled example:

    Dr  Travelling Expenses     <- the answer
    Cr  VIJAY KIRAN GAUTARAJ    <- the person

Importing them means the system starts out already knowing that Vijay claims
travel, that the driver claims fuel, and which expense heads your team actually
uses out of the 196 available. No model, no API, no cost - just your own data.

WHAT TO EXPORT FROM TALLY
-------------------------
Gateway of Tally -> Display More Reports -> Account Books -> Journal Register
(or Day Book), set the period to cover a year or more, then:

    Alt+E (Export) -> File format: Excel or CSV
                   -> Show Vch Type: Yes

Any layout with a Particulars column plus Debit/Credit works; the columns are
detected by name, not position.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

# How much a historical voucher counts relative to a live confirmation.
# Below 1.0 on purpose: history is real evidence, but it was coded under older
# habits and possibly by people who have since left. It should prime the system,
# not outvote what the team confirms today.
HISTORY_WEIGHT = 1


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _num(v) -> float | None:
    if v is None:
        return None
    s = re.sub(r"[^0-9.\-]", "", str(v))
    if not s or s in ("-", "."):
        return None
    try:
        return abs(float(s))
    except ValueError:
        return None


def read_rows(path: Path) -> list[dict]:
    """Read a Tally export into dicts. Columns are matched by NAME.

    Tally's export layout varies by version and by how many options are toggled
    on, so nothing here depends on column position.
    """
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls", ".xlsm"):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb.worksheets[0]
        grid = [[c.value for c in row] for row in ws.iter_rows()]
    elif suffix in (".csv", ".txt", ".tsv"):
        import csv
        delim = "\t" if suffix == ".tsv" else ","
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
            grid = [row for row in csv.reader(f, delimiter=delim)]
    else:
        raise SystemExit(f"Unsupported file type: {suffix} (use .xlsx or .csv)")

    # Find the header row: the first row mentioning "particulars".
    header_idx, header = None, None
    for i, row in enumerate(grid[:60]):
        cells = [_norm(c).lower() for c in row]
        if any("particular" in c for c in cells):
            header_idx, header = i, cells
            break
    if header_idx is None:
        raise SystemExit(
            "Could not find a 'Particulars' column.\n"
            "Export from Tally with: Alt+E -> Excel/CSV, and make sure the\n"
            "report is a Day Book or Journal Register."
        )

    def find(*names) -> int | None:
        for idx, c in enumerate(header):
            if any(n in c for n in names):
                return idx
        return None

    cols = {
        "particulars": find("particular"),
        "debit": find("debit"),
        "credit": find("credit"),
        "vch_type": find("vch type", "voucher type", "vchtype"),
        "date": find("date"),
        "vch_no": find("vch no", "voucher no"),
    }

    out = []
    for row in grid[header_idx + 1:]:
        if not any(_norm(c) for c in row):
            continue
        rec = {}
        for key, idx in cols.items():
            rec[key] = _norm(row[idx]) if idx is not None and idx < len(row) else ""
        rec["debit"] = _num(rec["debit"])
        rec["credit"] = _num(rec["credit"])
        out.append(rec)
    return out


def group_vouchers(rows: list[dict]) -> list[dict]:
    """Reassemble a flat export into vouchers.

    A Tally export puts each voucher across several rows: the first carries the
    date and voucher type, the rest are its ledger lines with blank dates. So a
    new voucher starts wherever a date or voucher number appears.
    """
    vouchers: list[dict] = []
    current: dict | None = None
    for r in rows:
        starts_new = bool(r["date"]) or bool(r["vch_no"])
        if starts_new or current is None:
            if current and current["lines"]:
                vouchers.append(current)
            current = {
                "date": r["date"], "vch_type": r["vch_type"],
                "vch_no": r["vch_no"], "lines": [],
            }
        if r["vch_type"] and not current["vch_type"]:
            current["vch_type"] = r["vch_type"]
        name = r["particulars"]
        # Skip totals, section headers and blank ledger lines.
        if not name or name.lower().startswith(("total", "grand total", "opening", "closing")):
            continue
        if r["debit"] or r["credit"]:
            current["lines"].append(
                {"ledger": name, "debit": r["debit"], "credit": r["credit"]})
    if current and current["lines"]:
        vouchers.append(current)
    return vouchers


def extract_pairs(vouchers: list[dict], expense_names: set[str],
                  people_names: set[str] | None = None):
    """Pull (person, expense_ledger) pairs out of Journal vouchers.

    The shape we want is the reimbursement pattern:
        Dr <expense>   Cr <person>

    A line is treated as an expense if its name is in the ledger master's
    expense/asset set - which is why the ledger master is loaded first. The
    credited side is then the person, whatever they are called. That avoids
    having to guess which Tally group holds staff.
    """
    pairs: list[tuple[str, str]] = []
    skipped = Counter()

    for v in vouchers:
        vt = (v["vch_type"] or "").lower()
        if vt and "journal" not in vt:
            skipped[v["vch_type"] or "unknown"] += 1
            continue

        debits = [l for l in v["lines"] if l["debit"]]
        credits = [l for l in v["lines"] if l["credit"]]
        if not debits or not credits:
            skipped["incomplete"] += 1
            continue

        expense_lines = [l for l in debits if l["ledger"] in expense_names]
        if not expense_lines:
            skipped["no expense ledger debited"] += 1
            continue

        for cr in credits:
            person = cr["ledger"]
            if people_names and person not in people_names:
                continue
            if person in expense_names:
                continue          # expense-to-expense reclass, not a claim
            for dr in expense_lines:
                pairs.append((person, dr["ledger"]))

    return pairs, skipped


def import_usage(rows: list[dict], expense_names: set[str], master: set[str]):
    """Ledger usage frequency from a SUMMARY-format Journal Register.

    Tally's Journal Register exports one row per voucher showing only the
    primary debit ledger - no credit line, so no person. PESPL's real export
    had 16,546 debit rows and exactly 2 credit rows.

    That still yields something very valuable: how often each expense head is
    ACTUALLY used. A ledger used 521 times is a far likelier answer than one
    used never, whatever the text similarity says - and it exposes ledgers the
    team relies on that are missing from our master entirely.
    """
    use = Counter()
    for r in rows:
        vt = (r["vch_type"] or "").lower()
        if "journal" not in vt and "jv" not in vt:
            continue
        name = r["particulars"]
        if not name or name.lower().startswith(("total", "opening", "closing", "grand")):
            continue
        if r["debit"] is None:
            continue        # credits are the other side, not the expense head
        use[name] += 1
    return use


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="Tally Day Book / Journal Register export (.xlsx or .csv)")
    ap.add_argument("--tally", action="store_true",
                    help="pull the Day Book straight from Tally's gateway")
    ap.add_argument("--dry-run", action="store_true", help="show what would be learned")
    ap.add_argument("--min-count", type=int, default=1,
                    help="ignore pairs seen fewer than this many times")
    args = ap.parse_args()

    if not args.file and not args.tally:
        ap.print_help()
        return 1

    import yaml
    from app.db import connect
    from app import ledgers as lm
    from app.classify import Memory

    cfg = yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))
    data_dir = BASE / cfg["app"]["data_dir"]

    ledger_json = data_dir / "ledgers.json"
    if not ledger_json.exists():
        print("No data/ledgers.json - run the app once to build the ledger master.")
        return 1
    all_ledgers = lm.load_json(ledger_json)
    expense_names = {
        l.name for l in all_ledgers
        if l.nature in set(cfg["classify"]["allowed_natures"])
    }
    print(f"Ledger master: {len(all_ledgers)} ledgers, "
          f"{len(expense_names)} usable as expense heads\n")

    if args.tally:
        print("Pulling the Day Book from Tally is not implemented yet - it needs "
              "the gateway enabled.\nExport to Excel instead (see the notes at the "
              "top of this file).")
        return 1

    path = Path(args.file)
    if not path.exists():
        print(f"File not found: {path}")
        return 1

    rows = read_rows(path)
    print(f"Read {len(rows)} rows from {path.name}")
    vouchers = group_vouchers(rows)
    print(f"Grouped into {len(vouchers)} vouchers")

    # Compare on collapsed whitespace. Tally's own exports are inconsistent
    # about double spaces - the trial balance has "Professional  Fees" while the
    # Journal Register has "Professional Fees", and treating those as different
    # ledgers reports a heavily-used account as missing.
    def key(n: str) -> str:
        return re.sub(r"\s+", " ", n).strip().lower()

    master_by_key = {key(l.name): l.name for l in all_ledgers}
    master = set(master_by_key)

    # ---- Always import usage frequency; it works on either export format ----
    use = import_usage(rows, expense_names, master)
    in_master = {n: c for n, c in use.items() if key(n) in master}
    missing = {n: c for n, c in use.items() if key(n) not in master}
    total_lines = sum(use.values()) or 1

    print(f"\nLEDGER USAGE  ({len(use)} distinct ledgers over {total_lines:,} journal lines)")
    print("-" * 74)
    print(f"{'USES':>7}  LEDGER")
    for n, c in use.most_common(20):
        flag = "" if key(n) in master else "   <- NOT in your ledger master"
        print(f"{c:>7}  {n[:44]}{flag}")

    if missing:
        pct = 100 * sum(missing.values()) / total_lines
        print()
        print(f"WARNING: {len(missing)} ledgers used in Tally are missing from the")
        print(f"         dropdown - {pct:.1f}% of all journal lines. The trial")
        print(f"         balance export was collapsed and did not list them.")
        print(f"         Top missing: " + ", ".join(list(missing)[:4]))
        print(f"         Fix: re-export the trial balance EXPANDED (press F5 /")
        print(f"         Alt+F1 for detailed before Alt+E), or enable Tally's")
        print(f"         HTTP gateway and POST /api/sync-ledgers.")

    use_keys = {key(n) for n in use}
    never = [n for n in expense_names if key(n) not in use_keys]
    print()
    print(f"Of {len(expense_names)} ledgers offered as suggestions, "
          f"{len(expense_names) - len(never)} have ever been used; "
          f"{len(never)} never have.")

    # ---- Person pairs need a DETAILED export with both sides ----------------
    pairs, skipped = extract_pairs(vouchers, expense_names)
    credit_rows = sum(1 for r in rows if r["credit"] is not None)

    if not pairs:
        print()
        print("=" * 74)
        print("NO PERSON DATA IN THIS EXPORT")
        print("=" * 74)
        print(f"This file has {sum(1 for r in rows if r['debit'] is not None):,} debit "
              f"rows but only {credit_rows} credit rows, so it is Tally's SUMMARY")
        print("view - one line per voucher, showing just the expense side. The")
        print("person being reimbursed is on the credit side, which is not here.")
        print()
        print("To get it, re-export with both sides showing:")
        print("  1. Gateway of Tally -> Display More Reports -> Account Books")
        print("     -> Journal Register  (or Day Book)")
        print("  2. Press F1 (or Alt+F1) for DETAILED view - you should now see")
        print("     two lines per voucher, one Dr and one Cr")
        print("  3. Alt+E -> Export -> Excel")
        print()
        print("Usage frequency from this file will still be imported - that alone")
        print("is worth having.")
        if args.dry_run:
            print("\nDry run - nothing written.")
            return 0
        conn = connect(BASE / cfg["app"]["db_path"])
        for n, c in use.items():
            canon = master_by_key.get(key(n), n)
            conn.execute(
                "INSERT INTO ledger_usage(ledger, count, in_master, source) "
                "VALUES (?,?,?,'journal_register') ON CONFLICT(ledger) DO UPDATE SET "
                "count=count+excluded.count, in_master=excluded.in_master, "
                "imported_at=datetime('now')",
                (canon, c, 1 if key(n) in master else 0))
        conn.commit()
        print(f"\nWritten: usage counts for {len(use)} ledgers.")
        print("Suggestions will now favour ledgers you actually use.")
        return 0

    if skipped:
        print("\nSkipped:")
        for reason, n in skipped.most_common(8):
            print(f"  {n:>6}  {reason}")

    counts: dict[tuple[str, str], int] = Counter(pairs)
    counts = {k: v for k, v in counts.items() if v >= args.min_count}

    by_person: dict[str, Counter] = defaultdict(Counter)
    for (person, ledger), n in counts.items():
        by_person[person][ledger] += n

    print(f"\nLearned {len(counts)} person->ledger pairs "
          f"across {len(by_person)} people\n")
    print(f"{'PERSON':<32} {'MOST COMMON LEDGER':<34} {'N':>5}  SPREAD")
    print("-" * 88)
    for person, ledgers in sorted(by_person.items(),
                                  key=lambda kv: -sum(kv[1].values()))[:25]:
        top, n = ledgers.most_common(1)[0]
        total = sum(ledgers.values())
        print(f"{person[:32]:<32} {top[:34]:<34} {n:>5}  "
              f"{len(ledgers)} ledger(s), {total} claims")

    if args.dry_run:
        print("\nDry run - nothing was written.")
        return 0

    conn = connect(BASE / cfg["app"]["db_path"])
    mem = Memory(conn)
    for (person, ledger), n in counts.items():
        mem.learn_person(person, ledger, source="tally_history",
                         weight=n * HISTORY_WEIGHT)
    for n, c in use.items():
        canon = master_by_key.get(key(n), n)
        conn.execute(
            "INSERT INTO ledger_usage(ledger, count, in_master, source) "
            "VALUES (?,?,?,'journal_register') ON CONFLICT(ledger) DO UPDATE SET "
            "count=count+excluded.count, in_master=excluded.in_master, "
            "imported_at=datetime('now')",
            (canon, c, 1 if key(n) in master else 0))
    conn.commit()

    total = conn.execute("SELECT COUNT(*) c FROM person_memory").fetchone()["c"]
    print(f"\nWritten. person_memory now holds {total} mappings.")
    print("Suggestions will use them immediately - no restart needed for new uploads.")
    print("\nReview or remove any of them in the dashboard under Learned mappings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

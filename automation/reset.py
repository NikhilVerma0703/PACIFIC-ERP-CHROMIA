#!/usr/bin/env python3
"""
Wipe test data and start clean.

    python reset.py                  clear everything (bills + learned mappings)
    python reset.py --keep-learning  clear bills, KEEP what the system learned
    python reset.py --yes            skip the confirmation prompt

Stop the app first (Ctrl+C in the window running run.py) - SQLite will refuse
to write while uvicorn holds the file open.

The ledger master (data/ledgers.json) is never touched.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import yaml

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

# Everything a test run creates.
TRANSACTIONAL = [
    "vouchers", "duplicates", "corrections", "ledger_requests",
    "agent_events",
    "extractions", "bills",          # extractions before bills: foreign key
]
# What the system worked out for itself.
LEARNED = ["vendor_memory", "token_weights", "layout_memory"]


def main() -> int:
    args = set(sys.argv[1:])
    keep_learning = "--keep-learning" in args
    assume_yes = "--yes" in args or "-y" in args

    cfg = yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))
    db_path = BASE / cfg["app"]["db_path"]
    data_dir = BASE / cfg["app"]["data_dir"]

    folders = [
        data_dir / "uploads",
        data_dir / "pages",
        BASE / cfg["tally"]["export_dir"],
    ]

    print()
    print("This will delete:")
    print(f"  - every bill, extraction, duplicate and voucher in {db_path.name}")
    if keep_learning:
        print("  - KEEPING learned vendor mappings and token weights")
    else:
        print("  - all learned vendor mappings and token weights")
    for f in folders:
        print(f"  - {f}")
    print(f"\nKeeping: {data_dir / 'ledgers.json'} (your ledger master)")
    print()

    if not assume_yes:
        if input("Type 'yes' to continue: ").strip().lower() not in ("yes", "y"):
            print("Cancelled - nothing was deleted.")
            return 1

    # --- database -----------------------------------------------------------
    if db_path.exists() and not keep_learning:
        # A full reset just deletes the file. Simpler than emptying every table,
        # and it also rebuilds cleanly if the schema has moved on since the
        # database was created.
        try:
            db_path.unlink()
            for extra in (db_path.with_suffix(db_path.suffix + "-wal"),
                          db_path.with_suffix(db_path.suffix + "-shm"),
                          db_path.with_suffix(db_path.suffix + "-journal")):
                extra.unlink(missing_ok=True)
            print(f"  deleted {db_path.name} (rebuilt on next start)")
        except PermissionError:
            print(f"\n{db_path.name} is locked - the app is still running.")
            print("Stop it (Ctrl+C in the window running run.py) and try again.")
            return 1
    elif db_path.exists():
        from app.db import connect
        try:
            conn = connect(db_path)
        except Exception as exc:  # noqa: BLE001
            print(f"\nCould not open the database: {exc}")
            print("\nIf that mentions a missing column, the database predates a")
            print("schema change. Run without --keep-learning to rebuild it.")
            return 1

        tables = TRANSACTIONAL
        for t in tables:
            try:
                n = conn.execute(f"SELECT COUNT(*) c FROM {t}").fetchone()["c"]
                conn.execute(f"DELETE FROM {t}")
                if n:
                    print(f"  cleared {n:>5} rows from {t}")
            except Exception as exc:  # noqa: BLE001
                print(f"  skipped {t}: {exc}")

        # Restart IDs at 1 so bill numbers match what you expect while testing.
        try:
            marks = ",".join("?" * len(tables))
            conn.execute(f"DELETE FROM sqlite_sequence WHERE name IN ({marks})", tables)
        except Exception:
            pass

        conn.commit()
        try:
            conn.execute("VACUUM")
        except Exception:
            pass
        conn.close()
    else:
        print("  no database yet - nothing to clear")

    # --- files --------------------------------------------------------------
    for folder in folders:
        if folder.exists():
            try:
                shutil.rmtree(folder)
                print(f"  removed {folder}")
            except Exception as exc:  # noqa: BLE001
                print(f"  could not remove {folder}: {exc}")
        folder.mkdir(parents=True, exist_ok=True)

    print("\nClean. Start the app again with:  python run.py\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

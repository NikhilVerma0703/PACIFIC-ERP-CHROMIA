"""SQLite schema and connection.

SQLite is right for the pilot: single file, zero admin, handles the volume a
finance team of this size generates. Move to Postgres when you need concurrent
writers across offices - the schema ports unchanged.

Every table carries created_at and created_by. Finance systems get audited, and
retrofitting an audit trail is painful.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bills (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filename        TEXT NOT NULL,
    -- One row per BILL, not per uploaded file. A 11-page PDF of receipts is 11
    -- separate claims, each needing its own ledger and amount, so pages are
    -- split at ingest and each becomes its own bill.
    stored_path     TEXT NOT NULL,   -- the page image
    source_file     TEXT,            -- the PDF/image it came from
    page_no         INTEGER DEFAULT 1,
    batch_id        TEXT,            -- groups everything from one upload
    file_sha256     TEXT NOT NULL,   -- hash of THIS PAGE, so dedupe is per bill
    text_layer      TEXT,            -- embedded PDF text for this page, if any
    -- Chosen by the clerk BEFORE upload, never read off the bill. A restaurant
    -- receipt does not say who paid for it; only the person submitting the
    -- claim knows that.
    person          TEXT,
    phash           TEXT,
    page_count      INTEGER DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'queued',
        -- queued | processing | review | needs_reupload | manual_entry
        -- | approved | posted | rejected | duplicate | error
    error           TEXT,
    auto_approved   INTEGER DEFAULT 0,   -- 1 = the agent approved it itself
    quality_verdict TEXT,
    quality_json    TEXT,
    ocr_engine      TEXT,
    ocr_variant     TEXT,
    ocr_confidence  REAL,
    ocr_text        TEXT,
    created_by      TEXT NOT NULL DEFAULT 'system',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_sha ON bills(file_sha256);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_batch ON bills(batch_id);

CREATE TABLE IF NOT EXISTS extractions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id         INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    vendor_name     TEXT,
    vendor_gstin    TEXT,
    invoice_no      TEXT,
    invoice_date    TEXT,
    taxable_value   REAL,
    cgst            REAL,
    sgst            REAL,
    igst            REAL,
    round_off       REAL,
    net_amount      REAL,
    hsn_sac         TEXT,
    ledger          TEXT,      -- expense ledger to debit
    person          TEXT,      -- person to reimburse (credited)
    narration       TEXT,      -- free-text voucher narration
    fields_json     TEXT,      -- per-field confidence + source
    suggestions_json TEXT,     -- ranked ledger suggestions as shown to the user
    confidence      REAL,
    arithmetic_ok   INTEGER DEFAULT 0,
    edited_by_user  INTEGER DEFAULT 0,
    created_by      TEXT NOT NULL DEFAULT 'system',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extr_bill ON extractions(bill_id);
CREATE INDEX IF NOT EXISTS idx_extr_dupkey
    ON extractions(vendor_gstin, invoice_no, net_amount);

CREATE TABLE IF NOT EXISTS vendor_memory (
    vendor_key  TEXT NOT NULL,
    ledger      TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (vendor_key, ledger)
);

-- Which ledgers a given person's claims actually go to.
-- The person is chosen at upload, so this signal is available BEFORE the bill
-- is even read, and it is the cheapest intelligence in the system: a driver
-- claims fuel and tolls, a salesperson claims travel and hotels. Bootstrappable
-- from existing Tally history (see import_history.py).
CREATE TABLE IF NOT EXISTS person_memory (
    person      TEXT NOT NULL,
    ledger      TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 1,
    last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
    source      TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed | tally_history
    PRIMARY KEY (person, ledger)
);

-- How often each ledger is ACTUALLY used, imported from Tally's Journal
-- Register. Two jobs:
--   1. A prior: a ledger used 521 times is a far likelier answer than one used
--      never, even when the text similarity is identical.
--   2. Pruning: of 196 candidates in the trial balance, only 112 were ever used
--      in a journal. The other 84 are dead weight in every suggestion list.
CREATE TABLE IF NOT EXISTS ledger_usage (
    ledger      TEXT PRIMARY KEY,
    count       INTEGER NOT NULL DEFAULT 0,
    in_master   INTEGER NOT NULL DEFAULT 1,  -- 0 = used in Tally but missing
                                             --     from our ledger master
    source      TEXT NOT NULL DEFAULT 'journal_register',
    imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS token_weights (
    token   TEXT NOT NULL,
    ledger  TEXT NOT NULL,
    weight  REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (token, ledger)
);
CREATE INDEX IF NOT EXISTS idx_token ON token_weights(token);

CREATE TABLE IF NOT EXISTS layout_memory (
    fingerprint TEXT PRIMARY KEY,
    vendor_key  TEXT,
    regions_json TEXT,
    hits        INTEGER DEFAULT 1,
    last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS corrections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id     INTEGER REFERENCES bills(id) ON DELETE SET NULL,
    field       TEXT NOT NULL,
    suggested   TEXT,
    chosen      TEXT,
    vendor_key  TEXT,
    created_by  TEXT NOT NULL DEFAULT 'system',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duplicates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id       INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    matched_bill_id INTEGER NOT NULL,
    layer         TEXT NOT NULL,     -- file_hash | image_hash | business_key
    score         REAL NOT NULL,
    detail        TEXT,
    overridden    INTEGER DEFAULT 0,
    override_reason TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vouchers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id       INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    xml           TEXT NOT NULL,
    mode          TEXT NOT NULL,     -- file | http
    status        TEXT NOT NULL,     -- generated | posted | failed
    tally_response TEXT,
    voucher_no    TEXT,
    created_by    TEXT NOT NULL DEFAULT 'system',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id     INTEGER REFERENCES bills(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    parent      TEXT,
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    created_by  TEXT NOT NULL DEFAULT 'system',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Everything the agent does on its own initiative, so a human can always
-- answer "what did the system do while I was away?" from one screen.
CREATE TABLE IF NOT EXISTS agent_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,      -- ingest | rescue | auto_approve | auto_post
                                    -- | anomaly | tune | sync | digest | error
    bill_id     INTEGER,
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_time ON agent_events(created_at);

-- BATCH EXPORTS. One row per generated XML file, plus which bills went into it.
--
-- This is the duplicate guard for the import step, and it exists because of a
-- decision made deliberately: the batch posts under Tally's standard Journal
-- rather than a custom voucher type, so Tally will NOT reject a re-import. That
-- was proven on live data - five imports of one test file produced ten vouchers
-- and Tally never objected. With no defence on Tally's side, ours has to be
-- reliable: a bill recorded here has been exported, and the next batch excludes
-- it and says why.
CREATE TABLE IF NOT EXISTS exports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ref           TEXT NOT NULL UNIQUE,   -- filename stem, shown to the user
    voucher_type  TEXT NOT NULL,
    bill_count    INTEGER NOT NULL DEFAULT 0,
    total         REAL NOT NULL DEFAULT 0,
    new_ledgers_json TEXT,
    xml           TEXT NOT NULL,
    -- imported | pending: set once a human confirms Tally accepted it, so the
    -- UI can distinguish "generated" from "actually in the books".
    imported      INTEGER NOT NULL DEFAULT 0,
    imported_note TEXT,
    created_by    TEXT NOT NULL DEFAULT 'system',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS export_bills (
    export_id   INTEGER NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
    bill_id     INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    voucher_no  TEXT,
    amount      REAL,
    PRIMARY KEY (export_id, bill_id)
);
CREATE INDEX IF NOT EXISTS idx_export_bill ON export_bills(bill_id);

CREATE TABLE IF NOT EXISTS ledgers_cache (
    name        TEXT PRIMARY KEY,
    parent      TEXT,
    nature      TEXT,
    is_postable INTEGER,
    synced_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _migrate(conn: sqlite3.Connection) -> list[str]:
    """Add columns that exist in SCHEMA but not in the database on disk.

    CREATE TABLE IF NOT EXISTS silently does nothing when the table already
    exists, so a database created by an older version keeps its old columns and
    every query naming a new one fails with "no such column". That is exactly
    what happened when per-page bills added batch_id, source_file, page_no and
    text_layer.

    Rather than maintain a hand-written list of migrations that has to be kept
    in sync with SCHEMA, the target shape is derived FROM SCHEMA itself: build
    it in a throwaway in-memory database, compare, and add whatever is missing.
    Self-maintaining, so future schema edits need no migration code.

    Returns the list of columns added, for logging.
    """
    ref = sqlite3.connect(":memory:")
    ref.executescript(SCHEMA)

    tables = [r[0] for r in ref.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%'").fetchall()]

    existing = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

    added: list[str] = []
    for table in tables:
        if table not in existing:
            continue  # executescript below will create it
        want = {r[1]: r for r in ref.execute(f"PRAGMA table_info({table})")}
        have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, info in want.items():
            if name in have:
                continue
            _, _, coltype, notnull, default, _pk = info
            decl = f"{name} {coltype or 'TEXT'}"

            # SQLite refuses a non-constant default in ALTER TABLE ADD COLUMN,
            # which rules out things like DEFAULT (datetime('now')). Add the
            # column plain and backfill existing rows instead.
            backfill = None
            if default is not None and "(" in str(default):
                backfill = str(default)
            elif default is not None:
                decl += f" DEFAULT {default}"
            elif notnull:
                decl += " DEFAULT ''"

            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {decl}")
                if backfill:
                    conn.execute(
                        f"UPDATE {table} SET {name} = {backfill} WHERE {name} IS NULL")
                added.append(f"{table}.{name}")
            except sqlite3.OperationalError as exc:
                db_file = conn.execute("PRAGMA database_list").fetchone()[2]
                raise RuntimeError(
                    f"Could not add column {table}.{name}: {exc}\n"
                    f"Delete {db_file} (or run: python reset.py) to rebuild "
                    f"from scratch."
                ) from exc

    ref.close()
    if added:
        conn.commit()
    return added


class ThreadLocalDB:
    """One SQLite connection PER THREAD, behind the plain connection interface.

    Why this exists: the app is multi-threaded in two ways that are easy to
    miss. FastAPI runs sync endpoints on a threadpool, and the OCR worker is a
    daemon thread. A single sqlite3 connection created with
    check_same_thread=False is *permitted* across threads but not *safe* -
    hammering one from 8 threads reproduces, within a second:

        DatabaseError: cannot start a transaction within a transaction
        DatabaseError: another row available / no more rows available
        OperationalError: cannot commit - no transaction is active

    Separate connections per thread make SQLite do the coordination it is
    actually good at (file-level locking, WAL snapshots). busy_timeout makes a
    writer wait for a lock instead of failing.

    The interface mirrors what callers already use (execute / executescript /
    commit / close / interrupt), so main.py, pipeline.py, reset.py and the
    tests all work unchanged.
    """

    def __init__(self, path: str, verbose: bool = True):
        self._path = path
        self._verbose = verbose
        self._local = threading.local()
        self._init_lock = threading.Lock()
        self._schema_done = False

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            return conn

        conn = sqlite3.connect(self._path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 8000")
        # WAL lets the worker write while handlers read. It needs shared-memory
        # support some network drives lack, so fall back rather than refuse to
        # start.
        try:
            conn.execute("PRAGMA journal_mode = WAL")
        except sqlite3.OperationalError:
            try:
                conn.execute("PRAGMA journal_mode = DELETE")
            except sqlite3.OperationalError:
                pass

        # Migration and schema creation run once per PROCESS, not per thread -
        # they are idempotent but not free, and two threads racing into VACUUM
        # or ALTER TABLE would deadlock on the file lock.
        with self._init_lock:
            if not self._schema_done:
                added = _migrate(conn)
                conn.executescript(SCHEMA)
                if added and self._verbose:
                    print(f"[ok] Database updated: added {len(added)} column(s) "
                          f"({', '.join(added[:6])}{'…' if len(added) > 6 else ''})")
                self._schema_done = True

        self._local.conn = conn
        return conn

    # -- the surface callers actually use ------------------------------------
    def execute(self, *a, **k):
        return self._conn().execute(*a, **k)

    def executemany(self, *a, **k):
        return self._conn().executemany(*a, **k)

    def executescript(self, *a, **k):
        return self._conn().executescript(*a, **k)

    def commit(self):
        return self._conn().commit()

    def rollback(self):
        return self._conn().rollback()

    def cursor(self):
        return self._conn().cursor()

    def close(self):
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None


def connect(path: str | Path, verbose: bool = True) -> ThreadLocalDB:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = ThreadLocalDB(str(path), verbose=verbose)
    db._conn()   # connect + migrate eagerly so startup errors surface at startup
    return db

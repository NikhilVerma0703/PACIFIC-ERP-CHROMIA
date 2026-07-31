"""
The autonomous parts - no APIs, no models, no cloud.

WATCH FOLDER
------------
Drop bills into  data/inbox/<PERSON NAME>/  and they get picked up, split,
read and classified without anyone opening the dashboard. The subfolder name
IS the claimant, which turns any scan-to-folder MFP or shared drive into a
hands-free intake:

    data/inbox/
        VARUN MUNDRA/
            fuel_june.pdf        <- processed as Varun's claims
        RAJESH KUMAR/
            stationery.jpg       <- processed as Rajesh's
        _done/                   <- originals move here afterwards
        _failed/                 <- unreadable files move here

Files are only picked up once their size has been stable across two scans,
because a file still being copied by the MFP or over the network is truncated
garbage if read immediately - the classic watch-folder bug.

INSIGHTS
--------
insights() computes everything the system can say about its own performance
from its own tables: correction hotspots, OCR variant win rates, learning
coverage, auto-approval counts, and alias suggestions mined from what clerks
confirmed. That last one closes the loop: the system reads its own confirmed
history and proposes vocabulary improvements to a human, instead of silently
rewriting its own matching rules.
"""
from __future__ import annotations

import shutil
import threading
import time
import uuid
from pathlib import Path

RESERVED_DIRS = {"_done", "_failed"}
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}


class InboxWatcher:
    def __init__(self, pipeline, cfg: dict, base_dir: Path):
        self.pipeline = pipeline
        agent_cfg = cfg.get("agent", {})
        self.root = (base_dir / agent_cfg.get("watch_dir", "data/inbox")).resolve()
        self.poll = max(2, int(agent_cfg.get("poll_seconds", 5)))
        # size seen on the previous scan; a file is only ingested when its size
        # is unchanged between scans (i.e. the copy has finished).
        self._pending: dict[str, int] = {}
        self._stop = threading.Event()

    # -- lifecycle -----------------------------------------------------------
    def ensure_dirs(self) -> None:
        (self.root / "_done").mkdir(parents=True, exist_ok=True)
        (self.root / "_failed").mkdir(parents=True, exist_ok=True)
        readme = self.root / "README.txt"
        if not readme.exists():
            readme.write_text(
                "Drop bills here, one folder per person:\n\n"
                "    inbox/VARUN MUNDRA/bill1.pdf\n"
                "    inbox/RAJESH KUMAR/receipt.jpg\n\n"
                "The folder name must match the person's ledger name in Tally.\n"
                "Files are processed automatically and moved to _done.\n"
                "Files placed directly in inbox/ (no person folder) are ignored.\n",
                encoding="utf-8")

    def start(self) -> threading.Thread:
        self.ensure_dirs()
        t = threading.Thread(target=self._loop, daemon=True,
                             name="inbox-watcher")
        t.start()
        return t

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.poll):
            try:
                ingested = self.scan_once()
                if ingested:
                    # Process synchronously on this thread - it already is the
                    # background thread, and doing so keeps ordering simple.
                    self.pipeline.process_queued()
            except Exception as exc:  # noqa: BLE001
                # The watcher must never die quietly; log and carry on.
                print(f"[inbox] scan failed: {type(exc).__name__}: {exc}")

    # -- one scan ------------------------------------------------------------
    def scan_once(self) -> list[int]:
        """Ingest every stable file. Returns the bill ids registered."""
        if not self.root.exists():
            return []
        bill_ids: list[int] = []
        seen_now: dict[str, int] = {}

        for person_dir in sorted(self.root.iterdir()):
            if not person_dir.is_dir() or person_dir.name in RESERVED_DIRS:
                continue
            person = person_dir.name.strip()
            if not person:
                continue

            for f in sorted(person_dir.iterdir()):
                if not f.is_file() or f.suffix.lower() not in ALLOWED_SUFFIXES:
                    continue
                try:
                    size = f.stat().st_size
                except OSError:
                    continue
                key = str(f)
                seen_now[key] = size

                if size == 0:
                    continue                     # still empty - wait
                if self._pending.get(key) != size:
                    continue                     # first sighting or still growing

                ids = self._ingest(f, person)
                bill_ids.extend(ids)

        self._pending = seen_now
        return bill_ids

    def _ingest(self, f: Path, person: str) -> list[int]:
        batch_id = "inbox-" + uuid.uuid4().hex[:10]
        try:
            ids = self.pipeline.register(
                str(f), f.name, user="inbox", person=person, batch_id=batch_id)
            self._move(f, "_done", person)
            print(f"[inbox] {person}: {f.name} -> {len(ids)} bill(s)")
            self.pipeline.log_event(
                "ingest", f"{person}: picked up {f.name} from the inbox "
                          f"({len(ids)} bill(s))", ids[0] if ids else None)
            return ids
        except Exception as exc:  # noqa: BLE001
            print(f"[inbox] {person}: {f.name} FAILED - {exc}")
            self.pipeline.log_event(
                "error", f"{person}: {f.name} could not be ingested ({exc})")
            self._move(f, "_failed", person)
            return []

    def _move(self, f: Path, bucket: str, person: str) -> None:
        dest_dir = self.root / bucket / person
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f.name
        if dest.exists():
            dest = dest_dir / f"{f.stem}_{int(time.time())}{f.suffix}"
        try:
            shutil.move(str(f), str(dest))
        except OSError:
            pass  # locked by the copier; it will be retried next scan


class MaintenanceLoop:
    """The agent's housekeeping heartbeat. Hourly by default.

    Each tick:
      - probe Tally's gateway. The day someone switches it on, ledgers and the
        people list sync themselves and an event says so - nobody has to know a
        sync command exists.
      - once per calendar day: write a digest of what the agent did yesterday,
        give files in _failed one more chance (copy hiccups are transient), and
        checkpoint the database.
    """

    def __init__(self, pipeline, cfg: dict, conn, base_dir: Path,
                 watcher: "InboxWatcher | None" = None):
        self.pipeline = pipeline
        self.cfg = cfg
        self.conn = conn
        self.base = base_dir
        self.watcher = watcher
        self.minutes = max(5, int(cfg.get("agent", {}).get("maintenance_minutes", 60)))
        self._stop = threading.Event()
        self._tally_was_up = False

    def start(self) -> threading.Thread:
        t = threading.Thread(target=self._loop, daemon=True, name="maintenance")
        t.start()
        return t

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        # First tick 15s after boot rather than an hour later, so "I enabled
        # the Tally gateway, now what?" answers itself: restart the app and the
        # sync happens while you watch the journal.
        if self._stop.wait(15):
            return
        try:
            self.tick()
        except Exception as exc:  # noqa: BLE001
            print(f"[maintenance] first tick failed: {type(exc).__name__}: {exc}")
        while not self._stop.wait(self.minutes * 60):
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001
                print(f"[maintenance] tick failed: {type(exc).__name__}: {exc}")

    # Public and side-effect-complete so tests can drive it directly.
    def tick(self) -> dict:
        report = {"tally_synced": False, "digest": None, "failed_retried": 0}
        report["tally_synced"] = self._try_tally_sync()
        if self._daily_due():
            report["digest"] = self.write_digest()
            report["failed_retried"] = self._retry_failed()
            self._checkpoint()
        return report

    # -- tally ---------------------------------------------------------------
    def _try_tally_sync(self) -> bool:
        from . import tally as tally_mod
        t = self.cfg.get("tally", {})
        try:
            ledgers = tally_mod.fetch_ledgers(
                t.get("company", ""), t.get("host", "localhost"),
                int(t.get("port", 9000)), timeout=5)
        except Exception:
            ledgers = []
        if not ledgers:
            self._tally_was_up = False
            return False
        for l in ledgers:
            self.conn.execute(
                "INSERT INTO ledgers_cache(name, parent, synced_at) "
                "VALUES (?,?,datetime('now')) ON CONFLICT(name) DO UPDATE SET "
                "parent=excluded.parent, synced_at=datetime('now')",
                (l["name"], l["parent"]))
        self.conn.commit()
        if not self._tally_was_up:
            self.pipeline.log_event(
                "sync", f"Tally gateway reachable - synced {len(ledgers)} "
                        f"ledgers into the local cache")
        self._tally_was_up = True
        return True

    # -- daily block ----------------------------------------------------------
    def _daily_due(self) -> bool:
        row = self.conn.execute(
            "SELECT MAX(created_at) m FROM agent_events WHERE kind='digest'"
        ).fetchone()
        last = (row["m"] or "")[:10]
        today = time.strftime("%Y-%m-%d")
        return last != today

    def write_digest(self) -> str:
        """One paragraph a human can read with coffee: what happened, what the
        agent handled alone, and what is waiting on a person."""
        def n(q, *a):
            r = self.conn.execute(q, a).fetchone()
            return r[0] if r and r[0] is not None else 0

        since = "datetime('now','-1 day')"
        processed = n(f"SELECT COUNT(*) FROM bills WHERE created_at >= {since}")
        auto = n(f"SELECT COUNT(*) FROM bills WHERE auto_approved=1 "
                 f"AND updated_at >= {since}")
        posted = n(f"SELECT COUNT(*) FROM vouchers WHERE created_by='agent' "
                   f"AND created_at >= {since}")
        waiting = n("SELECT COUNT(*) FROM bills WHERE status IN "
                    "('review','manual_entry','needs_reupload')")
        anomalies = n(f"SELECT COUNT(*) FROM agent_events WHERE kind='anomaly' "
                      f"AND created_at >= {since}")
        rescued = n(f"SELECT COUNT(*) FROM agent_events WHERE kind='rescue' "
                    f"AND created_at >= {since}")
        msg = (f"Daily digest: {processed} bill(s) in, {auto} auto-approved, "
               f"{posted} voucher(s) written by the agent, {rescued} failed "
               f"read(s) rescued, {anomalies} anomaly flag(s). "
               f"{waiting} bill(s) waiting on a human.")
        self.pipeline.log_event("digest", msg)
        return msg

    def _retry_failed(self) -> int:
        """Give _failed files one more chance - copy locks and half-written
        files are transient. Files that fail twice stay failed; endless retry
        of a genuinely broken file would spam the journal forever."""
        if not self.watcher:
            return 0
        failed_root = self.watcher.root / "_failed"
        if not failed_root.exists():
            return 0
        moved = 0
        for person_dir in failed_root.iterdir():
            if not person_dir.is_dir():
                continue
            for f in list(person_dir.iterdir()):
                if f.suffix.lower() not in ALLOWED_SUFFIXES:
                    continue
                if f.stem.endswith("_retry"):
                    continue                      # already had its second chance
                target_dir = self.watcher.root / person_dir.name
                target_dir.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.move(str(f), str(target_dir / f"{f.stem}_retry{f.suffix}"))
                    moved += 1
                except OSError:
                    pass
        if moved:
            self.pipeline.log_event(
                "ingest", f"Re-queued {moved} file(s) from _failed for one retry")
        return moved

    def _checkpoint(self) -> None:
        try:
            self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Self-insights
# ---------------------------------------------------------------------------
def insights(conn, ledgers: list) -> dict:
    """Everything the system can honestly report about itself, from its own
    tables. No estimates - every number is a count over recorded decisions."""
    out: dict = {}

    def rows(q, *a):
        try:
            return [dict(r) for r in conn.execute(q, a).fetchall()]
        except Exception:
            return []

    def one(q, *a, default=0):
        try:
            r = conn.execute(q, a).fetchone()
            return (r[0] if r and r[0] is not None else default)
        except Exception:
            return default

    total = one("SELECT COUNT(*) FROM extractions WHERE ledger IS NOT NULL")
    edited = one("SELECT COUNT(*) FROM extractions "
                 "WHERE ledger IS NOT NULL AND edited_by_user=1")
    out["confirmed_total"] = total
    out["accepted_unchanged"] = total - edited
    out["confirm_rate"] = round(100 * (total - edited) / total, 1) if total else None

    out["auto_approved"] = one("SELECT COUNT(*) FROM bills WHERE auto_approved=1")

    # Where the clerk keeps overriding us: each row is a lesson.
    out["correction_hotspots"] = rows(
        "SELECT suggested, chosen, COUNT(*) n FROM corrections "
        "WHERE suggested IS NOT NULL GROUP BY suggested, chosen "
        "ORDER BY n DESC LIMIT 15")

    # Which preprocessing variant actually wins on this company's bills. Once
    # one dominates, the others can be dropped from config for a 3x speedup.
    out["variant_wins"] = rows(
        "SELECT ocr_variant, COUNT(*) n, ROUND(AVG(ocr_confidence),1) avg_conf "
        "FROM bills WHERE ocr_variant IS NOT NULL AND ocr_variant != '' "
        "GROUP BY ocr_variant ORDER BY n DESC")

    out["memory"] = {
        "vendors": one("SELECT COUNT(DISTINCT vendor_key) FROM vendor_memory"),
        "trusted_vendors": one(
            "SELECT COUNT(*) FROM (SELECT vendor_key FROM vendor_memory "
            "GROUP BY vendor_key HAVING MAX(count) >= 3)"),
        "people": one("SELECT COUNT(DISTINCT person) FROM person_memory"),
        "tokens": one("SELECT COUNT(*) FROM token_weights"),
        "usage_ledgers": one("SELECT COUNT(*) FROM ledger_usage"),
    }

    out["status_counts"] = {r["status"]: r["n"] for r in rows(
        "SELECT status, COUNT(*) n FROM bills GROUP BY status")}

    # Alias mining: tokens that confirmed bills keep associating with a ledger,
    # but which appear nowhere in that ledger's search text. Adding them to
    # SEED_ALIASES makes the FIRST bill from a new vendor classify correctly,
    # not just repeats. Proposed to a human, never applied silently - a
    # learning system that rewrites its own matching rules unreviewed is how
    # one bad week becomes permanent.
    search_text = {l.name: l.search_text for l in ledgers}
    suggestions = []
    for r in rows("SELECT token, ledger, weight FROM token_weights "
                  "WHERE weight >= 3 ORDER BY weight DESC LIMIT 400"):
        st = search_text.get(r["ledger"])
        if st is not None and r["token"] not in st and len(r["token"]) >= 4:
            suggestions.append(r)
        if len(suggestions) >= 20:
            break
    out["alias_suggestions"] = suggestions

    # Ledgers Tally history says are alive but that no suggestion has ever
    # offered because they are missing from the master.
    out["missing_ledgers"] = rows(
        "SELECT ledger, count FROM ledger_usage WHERE in_master=0 "
        "ORDER BY count DESC LIMIT 15")

    return out

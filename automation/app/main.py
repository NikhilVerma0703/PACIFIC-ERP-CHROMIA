"""FastAPI application - the dashboard finance uses."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import uuid
from datetime import date
from pathlib import Path

import yaml
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates

from . import agent as agent_mod, dedupe, ledgers as ledger_mod, tally
from .db import connect
from .pipeline import Pipeline

BASE = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))
CFG["app"]["base_dir"] = str(BASE)   # so background threads resolve paths safely

app = FastAPI(title=CFG["app"]["name"])
templates = Jinja2Templates(directory=str(BASE / "app" / "templates"))

# The built-in pages have no login of their own - they exist so the engine is
# usable standalone. Once the ERP is the front end, set app.ui_enabled: false
# and ONLY the key-protected /api/v1 remains; the unauthenticated pages (which
# can confirm bills and post to Tally) stop being reachable on the LAN.
UI_ENABLED = bool((CFG.get("app", {}) or {}).get("ui_enabled", True))


@app.middleware("http")
async def _ui_gate(request: Request, call_next):
    if not UI_ENABLED and not request.url.path.startswith("/api/v1"):
        return JSONResponse(
            {"error": "The built-in UI is disabled. This engine is driven by "
                      "the ERP through /api/v1."},
            status_code=404,
        )
    return await call_next(request)

# The database location can be overridden without editing config, which matters
# when the app folder lives on a network share - SQLite needs real file locking
# and some shares do not provide it.
DB_PATH = os.environ.get("FINANCE_AGENT_DB") or str(BASE / CFG["app"]["db_path"])
conn = connect(DB_PATH)

LEDGER_JSON = BASE / CFG["app"]["data_dir"] / "ledgers.json"
MASTER_XML = BASE / CFG["app"]["data_dir"] / "MASTER.xml"
TRIAL_BALANCE = BASE / CFG["app"]["data_dir"] / "Trial Balance - PESPL.xlsx"

# Source of truth order: cached json -> Tally All Masters XML -> trial balance.
# The MASTER.xml route is strongly preferred: the trial balance is a *report*
# and Tally collapses it, so PESPL's trial balance listed 443 ledgers while the
# masters export has 2,538. Ledgers the team uses daily were simply absent.
if LEDGER_JSON.exists():
    LEDGERS = ledger_mod.load_json(LEDGER_JSON)
elif MASTER_XML.exists():
    from .master_xml import load_from_master_xml
    LEDGERS = load_from_master_xml(MASTER_XML)
    ledger_mod.save_json(LEDGERS, LEDGER_JSON)
elif TRIAL_BALANCE.exists():
    LEDGERS = ledger_mod.load_from_trial_balance(TRIAL_BALANCE)
    ledger_mod.save_json(LEDGERS, LEDGER_JSON)
else:
    LEDGERS = []

from .ocr.engine import configure_tesseract
TESSERACT_PATH = configure_tesseract(CFG["ocr"].get("tesseract_cmd"))

pipeline = Pipeline(conn, CFG, LEDGERS)

POSTABLE = [l for l in LEDGERS if l.is_postable
            and l.nature in set(CFG["classify"]["allowed_natures"])]


# --------------------------------------------------------------------------
# REST API for the Next.js ERP
# --------------------------------------------------------------------------
# The API router is given callables rather than snapshots. Ledgers synced from
# Tally land in ledgers_cache while the process is running, and a list captured
# at import time would never see them - so the API would keep offering a stale
# chart of accounts until someone restarted the service.
def _ledger_names() -> set[str]:
    return {l.name for l in POSTABLE} | {
        r["name"] for r in conn.execute("SELECT name FROM ledgers_cache")}


def _known_ledgers() -> set[str]:
    """Every ledger that already EXISTS in Tally - postable or not.

    Wider than the pickable set on purpose. This decides whether the export
    creates a master, and creating a duplicate of a ledger that exists but is
    not offered for coding (a bank account, a group total) would be a real mess
    to unpick in the books.
    """
    return ({l.name for l in LEDGERS}
            | {r["name"] for r in conn.execute("SELECT name FROM ledgers_cache")})




WATCHER: agent_mod.InboxWatcher | None = None
MAINTENANCE: agent_mod.MaintenanceLoop | None = None


@app.on_event("startup")
def resume_queued() -> None:
    """Pick up anything left mid-flight by a restart, and start the agents.

    Bills stuck in 'processing' were interrupted, not finished - put them back
    in the queue rather than leaving them invisible forever.
    """
    global WATCHER
    conn.execute("UPDATE bills SET status='queued' WHERE status='processing'")
    conn.commit()
    n = conn.execute("SELECT COUNT(*) c FROM bills WHERE status='queued'").fetchone()["c"]
    if n:
        print(f"[ok] Resuming {n} unprocessed bill(s) in the background")
        threading.Thread(target=pipeline.process_queued, daemon=True).start()

    if CFG.get("agent", {}).get("watch_enabled"):
        WATCHER = agent_mod.InboxWatcher(pipeline, CFG, BASE)
        WATCHER.start()
        print(f"[ok] Watching {WATCHER.root} - drop bills into a folder named "
              f"after the person")

    global MAINTENANCE
    MAINTENANCE = agent_mod.MaintenanceLoop(pipeline, CFG, conn, BASE, WATCHER)
    MAINTENANCE.start()
    print(f"[ok] Maintenance loop every {MAINTENANCE.minutes} min "
          f"(Tally probe, daily digest, failed-file retry)")


# --------------------------------------------------------------------------
# People
# --------------------------------------------------------------------------
def people_list() -> list[str]:
    """Staff who can be reimbursed.

    Sourced from Tally when reachable so a posted voucher can never fail on an
    unknown ledger name. Falls back to whoever has been used before, so the
    dashboard still works when Tally is closed - which it often is.
    """
    try:
        live = tally.fetch_people(CFG["tally"]["company"],
                                 CFG["tally"]["people_group"],
                                 CFG["tally"]["host"], CFG["tally"]["port"])
        if live:
            return live
    except Exception:
        pass
    # Offline source: the ledger master itself. The All Masters export records
    # every ledger's parent, so the claimant list is available with no live
    # connection at all - which is the whole point of the file-exchange design.
    group = (CFG["tally"].get("people_group") or "").strip().lower()
    from_master = sorted(
        l.name for l in LEDGERS
        if (l.parent or "").strip().lower() == group)

    seen = conn.execute(
        "SELECT DISTINCT person FROM bills WHERE person IS NOT NULL AND person != '' "
        "UNION SELECT DISTINCT person FROM extractions "
        "WHERE person IS NOT NULL AND person != ''"
    ).fetchall()
    used = {r["person"] for r in seen if r["person"]}
    return sorted(set(from_master) | used)


from . import api as api_mod  # noqa: E402  (needs people_list, defined above)

api_mod.CTX.update({
    "conn": conn, "cfg": CFG, "pipeline": pipeline, "ledgers": LEDGERS,
    "postable": POSTABLE, "people": people_list,
    "ledger_names": _ledger_names, "known_ledgers": _known_ledgers,
})
app.include_router(api_mod.router)

if not (os.environ.get("FINANCE_ENGINE_KEY") or (CFG.get("api", {}) or {}).get("key")):
    # Said out loud, every start. An unauthenticated service that writes
    # accounting data is not something anyone should discover by accident.
    # Checks the env var too: it is the supported way to supply the key
    # (config.yaml is tracked in git), and warning at someone who did it
    # correctly only pushes them into committing the secret to silence this.
    print("[!] No API key: FINANCE_ENGINE_KEY is unset and api.key is empty. "
          "Set FINANCE_ENGINE_KEY before the ERP talks to this engine.")


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def home(request: Request, status: str | None = None):
    q = ("SELECT b.*, e.net_amount, e.ledger, e.person, e.vendor_name, "
         "e.invoice_date, e.confidence "
         "FROM bills b LEFT JOIN extractions e ON e.id = ("
         "  SELECT MAX(id) FROM extractions WHERE bill_id = b.id) ")
    params: tuple = ()
    if status:
        q += "WHERE b.status = ? "
        params = (status,)
    q += "ORDER BY b.id DESC LIMIT 200"
    bills = conn.execute(q, params).fetchall()

    counts = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, COUNT(*) n FROM bills GROUP BY status").fetchall()}

    stats = conn.execute(
        "SELECT COUNT(*) total, SUM(edited_by_user) edited FROM extractions"
    ).fetchone()
    confirm_rate = None
    if stats and stats["total"]:
        confirm_rate = 100.0 * (1 - (stats["edited"] or 0) / stats["total"])

    return templates.TemplateResponse(request, "index.html", {
        "bills": bills, "counts": counts,
        "filter": status, "confirm_rate": confirm_rate,
        "total_bills": stats["total"] if stats else 0,
        "cfg": CFG,
    })


@app.get("/upload", response_class=HTMLResponse)
def upload_form(request: Request, person: str = ""):
    return templates.TemplateResponse(request, "upload.html", {
        "cfg": CFG, "people": people_list(), "person": person,
    })


@app.post("/upload")
async def do_upload(request: Request,
                    person: str = Form(...),
                    files: list[UploadFile] = File(...),
                    user: str = Form("clerk"), handwritten: str = Form("")):
    """Person first, then their bills.

    The person is chosen BEFORE upload and never read off the bill - a
    restaurant receipt does not record who paid for it. Selecting once and then
    dropping in that person's whole stack of bills also matches how
    reimbursement claims actually arrive: per person, several at a time.
    """
    person = person.strip()
    if not person:
        raise HTTPException(400, "Choose a person before uploading")

    batch_id = uuid.uuid4().hex[:12]
    created = 0
    for file in files:
        if not file.filename:
            continue
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name
        try:
            # Fast: splits pages and queues them. No OCR happens here, so the
            # browser gets a response in well under a second even for a
            # twenty-page scan.
            created += len(pipeline.register(
                tmp_path, file.filename, user, person=person,
                handwritten=bool(handwritten), batch_id=batch_id))
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    if not created:
        raise HTTPException(400, "No files were uploaded")

    threading.Thread(target=pipeline.process_queued, args=(batch_id,),
                     daemon=True).start()
    return RedirectResponse(f"/batch/{batch_id}", status_code=303)


@app.get("/batch/{batch_id}", response_class=HTMLResponse)
def batch_view(request: Request, batch_id: str):
    rows = _batch_rows(batch_id)
    if not rows:
        raise HTTPException(404, "Batch not found")
    return templates.TemplateResponse(request, "batch.html", {
        "cfg": CFG, "batch_id": batch_id,
        "person": rows[0]["person"], "rows": rows,
    })


def _batch_rows(batch_id: str):
    return conn.execute(
        "SELECT b.id, b.filename, b.page_no, b.status, b.error, b.person, "
        "b.ocr_confidence, b.quality_json, "
        "e.vendor_name, e.net_amount, e.invoice_date, e.ledger, e.suggestions_json "
        "FROM bills b LEFT JOIN extractions e ON e.id = ("
        "  SELECT MAX(id) FROM extractions WHERE bill_id = b.id) "
        "WHERE b.batch_id = ? ORDER BY b.id", (batch_id,)
    ).fetchall()


@app.get("/api/batch/{batch_id}")
def batch_status(batch_id: str):
    """Polled by the batch page so progress appears as each bill finishes."""
    rows = _batch_rows(batch_id)
    out = []
    for r in rows:
        sugg = json.loads(r["suggestions_json"]) if r["suggestions_json"] else []
        reasons = []
        if r["quality_json"]:
            try:
                reasons = json.loads(r["quality_json"]).get("reasons", [])
            except Exception:
                reasons = []
        out.append({
            "id": r["id"], "filename": r["filename"], "page_no": r["page_no"],
            "status": r["status"], "error": r["error"],
            "vendor": r["vendor_name"], "amount": r["net_amount"],
            "date": r["invoice_date"],
            "confidence": round(r["ocr_confidence"] or 0),
            "reason": (r["error"] or (reasons[0] if reasons else None)),
            "ledger": r["ledger"] or (sugg[0]["ledger"] if sugg else None),
            "ledger_score": round(sugg[0]["score"] * 100) if sugg else None,
            "ledger_band": sugg[0]["band"] if sugg else None,
        })
    pending = sum(1 for r in out if r["status"] in ("queued", "processing"))
    return JSONResponse({
        "batch_id": batch_id, "rows": out,
        "done": len(out) - pending, "total": len(out),
        "finished": pending == 0,
        "sum": sum(r["amount"] or 0 for r in out
                   if r["status"] not in ("duplicate", "error")),
    })


@app.get("/bill/{bill_id}", response_class=HTMLResponse)
def review(request: Request, bill_id: int):
    bill = conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
    if not bill:
        raise HTTPException(404, "Bill not found")
    ex = conn.execute(
        "SELECT * FROM extractions WHERE bill_id=? ORDER BY id DESC LIMIT 1",
        (bill_id,)).fetchone()
    dupes = conn.execute(
        "SELECT * FROM duplicates WHERE bill_id=? AND overridden=0", (bill_id,)
    ).fetchall()
    voucher = conn.execute(
        "SELECT * FROM vouchers WHERE bill_id=? ORDER BY id DESC LIMIT 1", (bill_id,)
    ).fetchone()

    suggestions = json.loads(ex["suggestions_json"]) if ex and ex["suggestions_json"] else []
    fields = json.loads(ex["fields_json"]) if ex and ex["fields_json"] else {}
    quality = json.loads(bill["quality_json"]) if bill["quality_json"] else {}

    # One bill is now exactly one page, so there is a single image to show.
    pages = [Path(bill["stored_path"]).name]
    siblings = conn.execute(
        "SELECT id, page_no, status FROM bills WHERE source_file = ? AND "
        "page_count IS NOT NULL ORDER BY page_no", (bill["source_file"],)
    ).fetchall() if bill["source_file"] else []

    return templates.TemplateResponse(request, "review.html", {
        "bill": bill, "ex": ex, "fields": fields,
        "suggestions": suggestions, "dupes": dupes, "quality": quality,
        "voucher": voucher, "people": people_list(),
        "person": (ex["person"] if ex and ex["person"] else bill["person"]) or "",
        # The search box offers the trial-balance master PLUS everything synced
        # live from Tally. The List of Accounts export returns leaf ledgers
        # only, so every synced name is genuinely postable - this is what makes
        # ledgers created in Tally this morning usable here this afternoon.
        "ledgers": sorted({l.name for l in POSTABLE} | {
            r["name"] for r in conn.execute("SELECT name FROM ledgers_cache")}),
        "pages": pages, "sha": bill["file_sha256"][:16],
        "siblings": siblings if len(siblings) > 1 else [],
        "today": date.today().isoformat(), "cfg": CFG,
    })


@app.get("/bill-image/{bill_id}")
def bill_image(bill_id: int):
    row = conn.execute("SELECT stored_path FROM bills WHERE id=?", (bill_id,)).fetchone()
    if not row or not Path(row["stored_path"]).exists():
        raise HTTPException(404)
    return FileResponse(row["stored_path"])


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------
def _guard_already_sent(bill_id: int, bill_status: str) -> None:
    """Refuse to send a bill to Tally twice.

    Two independent paths write vouchers - this single-bill post, and the batch
    export - and each recorded its own table. Checking only one meant a bill
    exported in a batch could still be posted individually (or the reverse),
    which is a duplicate payment.
    """
    if bill_status == "posted" or conn.execute(
            "SELECT 1 FROM export_bills WHERE bill_id=?", (bill_id,)).fetchone():
        raise HTTPException(
            409, "This bill has already been posted or exported to Tally")


@app.post("/bill/{bill_id}/confirm")
def confirm(bill_id: int, ledger: str = Form(...), person: str = Form(...),
            amount: float = Form(...), voucher_date: str = Form(""),
            narration: str = Form(""), user: str = Form("clerk")):
    pipeline.confirm(bill_id, ledger.strip(), person.strip(), amount,
                     voucher_date or None, user, narration)
    return RedirectResponse(f"/bill/{bill_id}?confirmed=1", status_code=303)


@app.post("/bill/{bill_id}/post")
def post_to_tally(bill_id: int, user: str = Form("approver"),
                  force: str = Form("")):
    bill = conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
    if not bill:
        raise HTTPException(404, "Unknown bill")
    _guard_already_sent(bill_id, bill["status"])
    ex = conn.execute(
        "SELECT * FROM extractions WHERE bill_id=? ORDER BY id DESC LIMIT 1",
        (bill_id,)).fetchone()
    if not ex or not ex["ledger"]:
        raise HTTPException(400, "Confirm the ledger before posting")

    blocking = conn.execute(
        "SELECT COUNT(*) n FROM duplicates WHERE bill_id=? AND overridden=0", (bill_id,)
    ).fetchone()["n"]
    if blocking:
        raise HTTPException(400, "Resolve the duplicate warning before posting")

    r = tally.Reimbursement(
        expense_ledger=ex["ledger"],
        person_ledger=ex["person"] or "",
        amount=float(ex["net_amount"] or 0),
        voucher_date=date.fromisoformat(ex["invoice_date"]) if ex["invoice_date"] else None,
        narration=ex["narration"] or f"Reimbursement to {ex['person']} - {ex['vendor_name'] or 'expense'}",
    )
    try:
        xml = tally.build_voucher_xml(
            r, CFG["tally"]["company"], CFG["tally"]["voucher_type"],
            CFG["tally"].get("cash_ledger"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    mode = CFG["tally"]["mode"]
    if mode == "http" and not force:
        # THE duplicate check the local database cannot do: vouchers that
        # accountants entered directly in Tally, outside this app. Runs at the
        # last moment before posting because that is when a duplicate becomes a
        # duplicate payment. An unreachable Tally counts as zero matches - the
        # actual post below will fail loudly on its own if Tally is down.
        vd = date.fromisoformat(ex["invoice_date"]) if ex["invoice_date"] else date.today()
        hits = tally.find_matching_vouchers(
            CFG["tally"]["company"], vd, ex["person"] or "",
            float(ex["net_amount"] or 0),
            CFG["tally"]["host"], CFG["tally"]["port"])
        if hits:
            raise HTTPException(409,
                f"Tally already has {hits} voucher(s) crediting "
                f"{ex['person']} with {float(ex['net_amount']):,.2f} on {vd}. "
                f"If this is genuinely a second claim, tick 'post anyway'.")
    if mode == "http":
        resp = tally.post_xml(xml, CFG["tally"]["host"], CFG["tally"]["port"])
        status = "posted" if resp.ok else "failed"
        message, raw, vno = resp.message, resp.raw, resp.voucher_no
    else:
        path = tally.write_xml_file(
            xml, str(BASE / CFG["tally"]["export_dir"]),
            f"reimb_{bill_id}_{ex['person'] or 'unknown'}")
        status, message, raw, vno = "generated", f"Tally XML written to {path}", "", None

    conn.execute(
        "INSERT INTO vouchers(bill_id, xml, mode, status, tally_response, "
        "voucher_no, created_by) VALUES (?,?,?,?,?,?,?)",
        (bill_id, xml, mode, status, (message + "\n" + raw)[:8000], vno, user),
    )
    if status in ("posted", "generated"):
        conn.execute("UPDATE bills SET status='posted', updated_at=datetime('now') "
                     "WHERE id=?", (bill_id,))
    conn.commit()
    return RedirectResponse(f"/bill/{bill_id}", status_code=303)


@app.post("/bill/{bill_id}/override-duplicate")
def override_dupe(bill_id: int, reason: str = Form(...), user: str = Form("approver")):
    if not reason.strip():
        raise HTTPException(400, "A reason is required to override a duplicate warning")
    dedupe.override(conn, bill_id, reason.strip(), user)
    return RedirectResponse(f"/bill/{bill_id}", status_code=303)


@app.post("/bill/{bill_id}/reject")
def reject(bill_id: int, reason: str = Form("")):
    conn.execute("UPDATE bills SET status='rejected', updated_at=datetime('now') "
                 "WHERE id=?", (bill_id,))
    conn.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/bill/{bill_id}/manual")
def manual_entry(bill_id: int, ledger: str = Form(...), person: str = Form(...),
                 amount: float = Form(...), voucher_date: str = Form(""),
                 vendor_name: str = Form(""), user: str = Form("clerk")):
    """Manual entry - always available, for handwritten bills, failed OCR, or
    a clerk who simply prefers to type."""
    exists = conn.execute("SELECT id FROM extractions WHERE bill_id=?",
                          (bill_id,)).fetchone()
    if exists:
        conn.execute(
            "UPDATE extractions SET ledger=?, person=?, net_amount=?, "
            "invoice_date=?, vendor_name=?, edited_by_user=1 WHERE id=?",
            (ledger, person, amount, voucher_date or None, vendor_name, exists["id"]))
    else:
        conn.execute(
            "INSERT INTO extractions(bill_id, vendor_name, invoice_date, net_amount, "
            "ledger, person, confidence, edited_by_user, created_by) "
            "VALUES (?,?,?,?,?,?,1.0,1,?)",
            (bill_id, vendor_name, voucher_date or None, amount, ledger, person, user))
    conn.commit()

    bill = conn.execute("SELECT ocr_text FROM bills WHERE id=?", (bill_id,)).fetchone()
    from .classify import vendor_key
    pipeline.memory.learn(vendor_key(vendor_name, None), ledger,
                          (bill["ocr_text"] if bill else "") or vendor_name, user=user)
    conn.execute("UPDATE bills SET status='approved', updated_at=datetime('now') "
                 "WHERE id=?", (bill_id,))
    conn.commit()
    return RedirectResponse(f"/bill/{bill_id}?confirmed=1", status_code=303)


@app.post("/ledger-request")
def ledger_request(name: str = Form(...), parent: str = Form(""),
                   reason: str = Form(""), bill_id: int = Form(None),
                   user: str = Form("clerk")):
    conn.execute(
        "INSERT INTO ledger_requests(bill_id, name, parent, reason, created_by) "
        "VALUES (?,?,?,?,?)",
        (bill_id, name.strip(), parent.strip() or CFG["tally"]["new_ledger_parent"],
         reason.strip(), user))
    conn.commit()
    return RedirectResponse(f"/bill/{bill_id}" if bill_id else "/", status_code=303)


@app.get("/requests", response_class=HTMLResponse)
def requests_page(request: Request):
    rows = conn.execute(
        "SELECT * FROM ledger_requests ORDER BY id DESC LIMIT 200").fetchall()
    return templates.TemplateResponse(request, "requests.html", {
        "rows": rows, "cfg": CFG})


@app.post("/requests/{req_id}/approve")
def approve_request(req_id: int, user: str = Form("approver")):
    """Approving creates the ledger in Tally and adds it to the local master."""
    r = conn.execute("SELECT * FROM ledger_requests WHERE id=?", (req_id,)).fetchone()
    if not r:
        raise HTTPException(404)
    xml = tally.build_ledger_master_xml(r["name"], r["parent"], CFG["tally"]["company"])
    if CFG["tally"]["mode"] == "http":
        resp = tally.post_xml(xml, CFG["tally"]["host"], CFG["tally"]["port"])
        ok = resp.ok
    else:
        tally.write_xml_file(xml, str(BASE / CFG["tally"]["export_dir"]),
                             f"ledger_{r['name']}")
        ok = True
    conn.execute("UPDATE ledger_requests SET status=? WHERE id=?",
                 ("approved" if ok else "pending", req_id))
    conn.commit()
    return RedirectResponse("/requests", status_code=303)


# --------------------------------------------------------------------------
# Learned mappings - everything the system infers must be visible and editable
# --------------------------------------------------------------------------
@app.get("/mappings", response_class=HTMLResponse)
def mappings(request: Request):
    rows = pipeline.memory.learned_mappings()
    corrections = conn.execute(
        "SELECT * FROM corrections ORDER BY id DESC LIMIT 100").fetchall()
    return templates.TemplateResponse(request, "mappings.html", {
        "rows": rows, "corrections": corrections, "cfg": CFG})


@app.post("/mappings/forget")
def forget(vendor_key: str = Form(...), ledger: str = Form(...)):
    pipeline.memory.forget(vendor_key, ledger)
    return RedirectResponse("/mappings", status_code=303)


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/api/ledgers")
def api_ledgers(q: str = ""):
    ql = q.lower().strip()
    names = [l.name for l in POSTABLE]
    if ql:
        names = [n for n in names if ql in n.lower()][:50]
    return JSONResponse(names[:200])


@app.api_route("/api/sync-ledgers", methods=["GET", "POST"])
def sync_ledgers():
    """Pull the live ledger list from Tally.

    The trial balance import is only a bootstrap. Accountants create ledgers
    directly in Tally, and the dashboard must never offer a name Tally will
    reject. Run this nightly.
    """
    try:
        live = tally.fetch_ledgers(CFG["tally"]["company"],
                                   CFG["tally"]["host"], CFG["tally"]["port"])
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=502)
    if not live:
        return JSONResponse(
            {"ok": False, "error": "Tally returned no ledgers. Is the company open?"},
            status_code=502)
    for l in live:
        conn.execute(
            "INSERT INTO ledgers_cache(name, parent, synced_at) "
            "VALUES (?,?,datetime('now')) ON CONFLICT(name) DO UPDATE SET "
            "parent=excluded.parent, synced_at=datetime('now')",
            (l["name"], l["parent"]))
    conn.commit()
    group = CFG["tally"].get("people_group", "").strip().lower()
    people = sorted(l["name"] for l in live
                    if (l.get("parent") or "").strip().lower() == group)
    pipeline.log_event(
        "sync", f"Manual sync: {len(live)} ledgers from Tally "
                f"({len(people)} people under '{CFG['tally']['people_group']}')")
    return JSONResponse({"ok": True, "ledgers": len(live),
                         "people": len(people), "people_names": people[:50]})


@app.get("/journal", response_class=HTMLResponse)
def journal_page(request: Request, kind: str = ""):
    q = "SELECT * FROM agent_events "
    params: tuple = ()
    if kind:
        q += "WHERE kind=? "
        params = (kind,)
    q += "ORDER BY id DESC LIMIT 300"
    events = conn.execute(q, params).fetchall()
    kinds = [r["kind"] for r in conn.execute(
        "SELECT DISTINCT kind FROM agent_events ORDER BY kind")]
    return templates.TemplateResponse(request, "journal.html", {
        "cfg": CFG, "events": events, "kinds": kinds, "filter": kind})


@app.get("/insights", response_class=HTMLResponse)
def insights_page(request: Request):
    data = agent_mod.insights(conn, LEDGERS)
    return templates.TemplateResponse(request, "insights.html", {
        "cfg": CFG, "d": data})


@app.get("/api/health")
def health():
    return {"ok": True, "ledgers": len(LEDGERS), "postable": len(POSTABLE),
            "tally_mode": CFG["tally"]["mode"], "tesseract": TESSERACT_PATH}

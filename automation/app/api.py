"""
REST API for the Next.js ERP.  Everything under /api/v1.

WHY THIS EXISTS
---------------
The built-in HTML dashboard was how this engine got tested against real bills,
but it is not where PESPL's finance team will work: reimbursements are a feature
of the ERP, alongside everything else they already log into. So the engine
becomes a service and Next.js becomes the only user interface.

The division of labour, decided with the user:
  - Next.js owns LOGIN and the screens.
  - The engine owns the FILES, the OCR, the learning tables and the Tally XML.
    Nothing is duplicated in the ERP's database; a bill image lives here and is
    served back over a URL.

AUTH
----
One shared API key in config.yaml, sent as X-API-Key by the Next.js *server*
(never the browser - the key must not reach client-side JavaScript). The ERP has
already authenticated the human, so the engine does not repeat that work; it
just needs to know the request came from the ERP rather than from any laptop on
the same network.

The logged-in user's name travels in X-User and is stored against every action.
That keeps the audit trail truthful - "SHALMAN confirmed this at 14:32" - without
the engine having to verify ERP session tokens.

If tally.api_key is left empty the key check is skipped, which keeps local
development frictionless. The engine says so loudly at startup, because an
unauthenticated service that writes accounting data is not something to discover
by accident.

DESIGN NOTES
------------
* Every response is JSON, including errors: {"error": "...", "detail": ...}.
  Next.js should never have to parse an HTML error page.
* Money is always a number, never a formatted string. Formatting is the UI's job
  and Indian digit grouping in JSON would be a bug waiting to happen.
* Dates are ISO (YYYY-MM-DD) on the wire. Tally's own DD-MM-YYYY / 20260730
  formats are an implementation detail of the XML and stay behind this boundary.
* Reads never mutate. Only POSTs change anything, so the ERP can retry a GET.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import uuid
from datetime import date, datetime
from pathlib import Path

from fastapi import (APIRouter, Depends, File, Form, Header, HTTPException,
                     Request, UploadFile)
from fastapi.responses import FileResponse, JSONResponse

from .export_batch import (BatchLine, batch_filename, build_batch,
                           build_batch_excel, voucher_number)

router = APIRouter(prefix="/api/v1")

# Set by main.py at import time. Kept in a mutable holder rather than imported
# from main, because main imports this module - the other direction would be a
# circular import.
CTX: dict = {}


def ctx(key: str):
    if key not in CTX:
        raise HTTPException(503, "API not initialised")
    return CTX[key]


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def require_key(x_api_key: str | None = Header(default=None),
                x_user: str | None = Header(default=None)) -> str:
    """Verify the shared key and return the acting ERP user.

    The user falls back to "erp" rather than failing: an action recorded against
    a generic name is still better than a rejected request, and the ERP can be
    fixed to send the header without the engine going down.
    """
    # config.yaml is tracked in git, so the real key is supplied out of band via
    # the environment; the config value stays "" in the repo. Env wins when set.
    expected = os.environ.get("FINANCE_ENGINE_KEY") or (
        ctx("cfg").get("api", {}) or {}).get("key") or ""
    if not expected:
        # FAIL CLOSED. This used to skip the whole check when no key was
        # configured - and config.yaml ships with key: "" - so as delivered
        # every route that confirms bills and writes Tally vouchers accepted
        # anonymous requests. Local development is allowed explicitly via
        # api.allow_unauthenticated, never by forgetting to set a key.
        if not (ctx("cfg").get("api", {}) or {}).get("allow_unauthenticated"):
            raise HTTPException(
                503, "This engine has no API key configured. Set the "
                     "FINANCE_ENGINE_KEY environment variable (config.yaml is "
                     "tracked in git, so the secret must not go there), or set "
                     "api.allow_unauthenticated: true for local development.")
        return (x_user or "").strip() or "erp"
    if not x_api_key:
        raise HTTPException(401, "X-API-Key header is missing")
    # Constant-time compare: a shared secret should not leak its prefix
    # through response timing. encode() because compare_digest rejects
    # non-ASCII str, which would surface as a 500 instead of a 401.
    import hmac
    if not hmac.compare_digest(str(x_api_key).encode("utf-8"),
                               str(expected).encode("utf-8")):
        raise HTTPException(401, "Invalid API key")
    return (x_user or "").strip() or "erp"


Actor = Depends(require_key)


# --------------------------------------------------------------------------
# Upload spooling
# --------------------------------------------------------------------------
# A bill is a photo or a PDF. Without a cap, one mistaken 4 GB upload fills the
# disk that also holds the SQLite database - which is the audit trail.
ALLOWED_UPLOAD_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff",
                      ".bmp", ".webp", ".heic"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024        # 25 MB - a phone photo is ~5 MB


def _spool(f) -> str:
    """Stream one upload to a temp file, enforcing type and size.

    Extension allowlist rather than magic-byte sniffing on purpose: a corrupt
    or unreadable file must still become a visible error BILL that a clerk can
    re-scan, not a silent rejection.
    """
    suffix = Path(f.filename or "").suffix.lower()
    if suffix not in ALLOWED_UPLOAD_EXT:
        raise ValueError(f"{suffix or 'file'} is not a bill - upload a PDF or a photo")
    total = 0
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        while chunk := f.file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                tmp.close()
                Path(tmp_path).unlink(missing_ok=True)
                raise ValueError(
                    f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
            tmp.write(chunk)
    return tmp_path


# --------------------------------------------------------------------------
# Serialisation
# --------------------------------------------------------------------------
def _json(row) -> dict:
    return dict(row) if row is not None else {}


def _loads(s):
    if not s:
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def _iso(d: str | None) -> str | None:
    """Normalise whatever the extractor produced into ISO, or None.

    Dates read off a bill by OCR are the least trustworthy field in the system,
    so anything unparseable becomes None rather than a guess. A missing date is
    obvious in the UI; a wrong one is not.
    """
    if not d:
        return None
    s = str(d).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y",
                "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def bill_summary(r) -> dict:
    """The shape a list row needs - deliberately small.

    A hundred of these go over the wire at once, so OCR text and per-field
    confidence are excluded; they belong to the detail endpoint.
    """
    sugg = _loads(r["suggestions_json"]) or []
    top = sugg[0] if sugg else None
    return {
        "id": r["id"],
        "filename": r["filename"],
        "page_no": r["page_no"],
        "status": r["status"],
        "error": r["error"],
        "person": r["person"],
        "vendor": r["vendor_name"],
        "amount": r["net_amount"],
        "date": _iso(r["invoice_date"]),
        "ledger": r["ledger"] or (top["ledger"] if top else None),
        "ledger_confirmed": bool(r["ledger"]),
        "confidence": round(r["ocr_confidence"] or 0),
        "suggestion": ({"ledger": top["ledger"],
                        "score": round(top["score"], 4),
                        "band": top["band"]} if top else None),
        "auto_approved": bool(r["auto_approved"]),
        "exported": bool(r["export_id"]),
        "created_at": r["created_at"],
    }


LIST_SQL = """
SELECT b.id, b.filename, b.page_no, b.status, b.error, b.person, b.batch_id,
       b.ocr_confidence, b.auto_approved, b.created_at,
       e.vendor_name, e.net_amount, e.invoice_date, e.ledger, e.suggestions_json,
       (SELECT export_id FROM export_bills WHERE bill_id = b.id LIMIT 1) AS export_id
FROM bills b
LEFT JOIN extractions e
       ON e.id = (SELECT MAX(id) FROM extractions WHERE bill_id = b.id)
"""


# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------
@router.get("/health")
def health(user: str = Actor):
    conn, cfg = ctx("conn"), ctx("cfg")
    counts = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, COUNT(*) n FROM bills GROUP BY status")}
    return {
        "ok": True,
        "user": user,
        "company": cfg["tally"]["company"],
        "voucher_type": cfg["tally"].get("batch_voucher_type", "Journal"),
        "ledgers": len(ctx("postable")),
        "dedupe_enabled": bool(cfg["dedupe"]["enabled"]),
        "bills_by_status": counts,
        "awaiting_review": counts.get("review", 0) + counts.get("manual_entry", 0),
        "ready_to_export": counts.get("approved", 0),
    }


@router.get("/people")
def people(q: str = "", limit: int = 50, user: str = Actor):
    """The claimant list for the ERP's dropdown.

    Sourced from the ledgers under tally.people_group, so a name chosen here
    always exists in Tally and the import cannot fail on it.
    """
    names = ctx("people")()
    ql = q.strip().lower()
    if ql:
        starts = [n for n in names if n.lower().startswith(ql)]
        contains = [n for n in names if ql in n.lower() and n not in starts]
        names = starts + contains
    return {"people": names[:max(1, min(limit, 500))], "total": len(names)}


@router.get("/ledgers")
def ledgers(q: str = "", limit: int = 25, person: str = "", user: str = Actor):
    """Ledger search for the ERP's picker.

    With no query, returns what THIS person has claimed before rather than an
    arbitrary alphabetical slice - for a driver that is fuel and tolls, which is
    usually the answer before anyone types anything.
    """
    conn = ctx("conn")
    names = ctx("ledger_names")()
    ql = q.strip().lower()
    limit = max(1, min(limit, 200))

    if not ql and person.strip():
        prior = [r["ledger"] for r in conn.execute(
            "SELECT ledger FROM person_memory WHERE person=? "
            "ORDER BY count DESC LIMIT ?", (person.strip(), limit))]
        if prior:
            return {"ledgers": prior, "source": "this person's history"}

    if not ql:
        # Fall back to what the company actually uses, not the alphabet.
        popular = [r["ledger"] for r in conn.execute(
            "SELECT ledger FROM ledger_usage WHERE ledger IN "
            "(SELECT ledger FROM ledger_usage) ORDER BY count DESC LIMIT ?",
            (limit,)) if r["ledger"] in names]
        return {"ledgers": popular or sorted(names)[:limit],
                "source": "most used" if popular else "all"}

    starts = [n for n in names if n.lower().startswith(ql)]
    contains = [n for n in names if ql in n.lower() and n not in starts]
    return {"ledgers": (starts + contains)[:limit], "source": "search"}


# --------------------------------------------------------------------------
# Upload
# --------------------------------------------------------------------------
@router.post("/bills")
async def upload(person: str = Form(...),
                 files: list[UploadFile] = File(...),
                 handwritten: bool = Form(False),
                 user: str = Actor):
    """Upload one person's bills. Returns immediately; OCR runs in background.

    PERSON FIRST, deliberately. The claimant is never read off the bill - a
    restaurant receipt does not record who paid for it. The ERP picks the person,
    then drops in their whole stack, which is also how claims physically arrive.

    Multi-page PDFs are split: 11 pages of receipts become 11 bills, each with
    its own ledger and amount. So bill_ids is usually longer than files.
    """
    pipeline = ctx("pipeline")
    person = person.strip()
    if not person:
        raise HTTPException(400, "person is required")

    batch_id = uuid.uuid4().hex[:12]
    bill_ids: list[int] = []
    rejected: list[dict] = []

    for f in files:
        if not f.filename:
            continue
        try:
            tmp_path = _spool(f)
        except ValueError as exc:
            # Wrong type or over the size cap: reject this file, keep the stack.
            rejected.append({"filename": f.filename, "reason": str(exc)})
            continue
        try:
            bill_ids += pipeline.register(tmp_path, f.filename, user,
                                          person=person,
                                          handwritten=handwritten,
                                          batch_id=batch_id)
        except Exception as exc:  # noqa: BLE001
            # One unreadable file must not lose the other nine in the stack.
            rejected.append({"filename": f.filename, "reason": str(exc)})
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    if not bill_ids:
        raise HTTPException(400, {"error": "Nothing could be accepted",
                                  "rejected": rejected})

    threading.Thread(target=pipeline.process_queued, args=(batch_id,),
                     daemon=True).start()
    return {"batch_id": batch_id, "bill_ids": bill_ids,
            "count": len(bill_ids), "person": person, "rejected": rejected,
            "poll": f"/api/v1/batches/{batch_id}"}


@router.get("/batches/{batch_id}")
def batch(batch_id: str, user: str = Actor):
    """Poll this while OCR runs. finished=true when every page is done."""
    conn = ctx("conn")
    rows = conn.execute(LIST_SQL + " WHERE b.batch_id = ? ORDER BY b.id",
                        (batch_id,)).fetchall()
    if not rows:
        raise HTTPException(404, "Unknown batch")
    out = [bill_summary(r) for r in rows]
    pending = sum(1 for r in out if r["status"] in ("queued", "processing"))
    return {
        "batch_id": batch_id, "person": rows[0]["person"],
        "bills": out, "total": len(out), "done": len(out) - pending,
        "finished": pending == 0,
        "sum": round(sum(r["amount"] or 0 for r in out
                         if r["status"] not in ("duplicate", "error")), 2),
    }


# --------------------------------------------------------------------------
# Review
# --------------------------------------------------------------------------
@router.get("/bills")
def list_bills(status: str = "", person: str = "", batch_id: str = "",
               exported: bool | None = None,
               limit: int = 50, offset: int = 0, user: str = Actor):
    """Filterable list. status accepts a comma-separated set."""
    conn = ctx("conn")
    where, params = [], []
    if status:
        wanted = [s.strip() for s in status.split(",") if s.strip()]
        where.append("b.status IN (%s)" % ",".join("?" * len(wanted)))
        params += wanted
    if person:
        where.append("b.person = ?")
        params.append(person.strip())
    if batch_id:
        where.append("b.batch_id = ?")
        params.append(batch_id)
    if exported is not None:
        where.append("export_id IS %s NULL" % ("NOT" if exported else ""))

    sql = LIST_SQL + (" WHERE " + " AND ".join(where) if where else "")
    total = conn.execute(
        f"SELECT COUNT(*) n FROM ({sql})", params).fetchone()["n"]
    limit = max(1, min(limit, 500))
    rows = conn.execute(sql + " ORDER BY b.id DESC LIMIT ? OFFSET ?",
                        params + [limit, max(0, offset)]).fetchall()
    return {"bills": [bill_summary(r) for r in rows], "total": total,
            "limit": limit, "offset": offset}


@router.get("/bills/{bill_id}")
def bill_detail(bill_id: int, user: str = Actor):
    """Everything the review screen needs, in one round trip.

    Includes the raw OCR text. That panel matters more than it looks: when a
    suggestion is wrong, the clerk can see instantly whether the OCR misread the
    bill or the classifier misjudged good text - and those need different fixes.
    """
    conn = ctx("conn")
    b = conn.execute("SELECT * FROM bills WHERE id=?", (bill_id,)).fetchone()
    if not b:
        raise HTTPException(404, "Unknown bill")
    ex = conn.execute("SELECT * FROM extractions WHERE bill_id=? "
                      "ORDER BY id DESC LIMIT 1", (bill_id,)).fetchone()
    dupes = conn.execute("SELECT * FROM duplicates WHERE bill_id=? "
                         "AND overridden=0", (bill_id,)).fetchall()
    exp = conn.execute(
        "SELECT e.ref, e.imported, eb.voucher_no FROM export_bills eb "
        "JOIN exports e ON e.id = eb.export_id WHERE eb.bill_id=? "
        "ORDER BY eb.export_id DESC LIMIT 1", (bill_id,)).fetchone()

    quality = _loads(b["quality_json"]) or {}
    return {
        "id": b["id"],
        "filename": b["filename"],
        "page_no": b["page_no"],
        "page_count": b["page_count"],
        "batch_id": b["batch_id"],
        "status": b["status"],
        "error": b["error"],
        "person": (ex["person"] if ex and ex["person"] else b["person"]),
        "auto_approved": bool(b["auto_approved"]),
        "image_url": f"/api/v1/bills/{bill_id}/image",
        "sha256": b["file_sha256"],
        "ocr": {
            "confidence": round(b["ocr_confidence"] or 0),
            "text": b["ocr_text"] if "ocr_text" in b.keys() else None,
            "quality": quality,
            "needs_reupload": b["status"] == "needs_reupload",
            "reasons": quality.get("reasons", []),
        },
        "extracted": {
            "vendor": ex["vendor_name"] if ex else None,
            "gstin": ex["vendor_gstin"] if ex else None,
            "invoice_no": ex["invoice_no"] if ex else None,
            "date": _iso(ex["invoice_date"]) if ex else None,
            "taxable": ex["taxable_value"] if ex else None,
            "cgst": ex["cgst"] if ex else None,
            "sgst": ex["sgst"] if ex else None,
            "igst": ex["igst"] if ex else None,
            "amount": ex["net_amount"] if ex else None,
            "arithmetic_ok": bool(ex["arithmetic_ok"]) if ex else False,
            "fields": _loads(ex["fields_json"]) if ex else None,
        } if ex else None,
        "ledger": ex["ledger"] if ex else None,
        "narration": ex["narration"] if ex else None,
        "suggestions": (_loads(ex["suggestions_json"]) or []) if ex else [],
        "duplicates": [{
            "matched_bill_id": d["matched_bill_id"], "layer": d["layer"],
            "score": round(d["score"], 4), "detail": d["detail"],
        } for d in dupes],
        "export": ({"ref": exp["ref"], "voucher_no": exp["voucher_no"],
                    "imported": bool(exp["imported"])} if exp else None),
    }


@router.get("/bills/{bill_id}/image")
def bill_image(bill_id: int, user: str = Actor):
    """The page image. The ERP embeds this URL; the engine keeps the file."""
    r = ctx("conn").execute("SELECT stored_path FROM bills WHERE id=?",
                            (bill_id,)).fetchone()
    if not r or not Path(r["stored_path"]).exists():
        raise HTTPException(404, "No image for that bill")
    return FileResponse(r["stored_path"])


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------
@router.post("/bills/{bill_id}/confirm")
async def confirm(bill_id: int, request: Request, user: str = Actor):
    """Approve a bill: ledger + person + amount, and the system learns from it.

    Accepts JSON. Every confirmation feeds vendor memory, person memory and the
    token weights, which is what makes the tenth bill from a vendor land on the
    right ledger without anyone choosing it.
    """
    body = await request.json()
    ledger = str(body.get("ledger", "")).strip()
    person = str(body.get("person", "")).strip()
    if not ledger or not person:
        raise HTTPException(400, "ledger and person are required")
    try:
        amount = round(float(body.get("amount")), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")
    if amount <= 0:
        raise HTTPException(400, "amount must be greater than zero")

    conn = ctx("conn")
    if not conn.execute("SELECT 1 FROM bills WHERE id=?", (bill_id,)).fetchone():
        raise HTTPException(404, "Unknown bill")
    if conn.execute("SELECT 1 FROM export_bills WHERE bill_id=?",
                    (bill_id,)).fetchone():
        # Changing a bill after its voucher is in an exported file would put our
        # records and Tally out of step with no way to tell which is right.
        raise HTTPException(409, "This bill has already been exported to Tally")

    ctx("pipeline").confirm(bill_id, ledger, person, amount,
                            body.get("date") or None, user,
                            str(body.get("narration") or ""))
    return {"ok": True, "bill_id": bill_id, "status": "approved",
            "ledger": ledger, "person": person, "amount": amount}


@router.post("/bills/{bill_id}/reject")
async def reject(bill_id: int, request: Request, user: str = Actor):
    body = await request.json() if await request.body() else {}
    reason = str(body.get("reason") or "").strip()
    conn = ctx("conn")
    if not conn.execute("SELECT 1 FROM bills WHERE id=?", (bill_id,)).fetchone():
        raise HTTPException(404, "Unknown bill")
    conn.execute("UPDATE bills SET status='rejected', error=? WHERE id=?",
                 (reason or "rejected in the ERP", bill_id))
    conn.commit()
    ctx("pipeline").log_event("error", f"{user} rejected bill {bill_id}"
                              + (f": {reason}" if reason else ""), bill_id)
    return {"ok": True, "bill_id": bill_id, "status": "rejected"}


@router.post("/bills/{bill_id}/override-duplicate")
async def override_duplicate(bill_id: int, request: Request, user: str = Actor):
    """Accept a bill the duplicate check flagged. A reason is mandatory.

    Genuine repeats happen - the same person eats at the same place twice in a
    week for the same amount. But a duplicate payment is real money, so the
    override is recorded with who and why, and the bill returns to normal review
    rather than being approved outright.
    """
    body = await request.json()
    reason = str(body.get("reason") or "").strip()
    if len(reason) < 4:
        raise HTTPException(400, "A reason is required to override a duplicate")
    conn = ctx("conn")
    n = conn.execute(
        "UPDATE duplicates SET overridden=1, override_reason=? "
        "WHERE bill_id=? AND overridden=0", (f"{user}: {reason}", bill_id))
    if not n.rowcount:
        raise HTTPException(404, "No open duplicate warning on that bill")
    conn.execute("UPDATE bills SET status='review' WHERE id=? AND status='duplicate'",
                 (bill_id,))
    conn.commit()
    ctx("pipeline").log_event(
        "anomaly", f"{user} overrode the duplicate warning on bill {bill_id}: "
                   f"{reason}", bill_id)
    return {"ok": True, "bill_id": bill_id, "status": "review"}


# --------------------------------------------------------------------------
# Batch export - the point of the whole system
# --------------------------------------------------------------------------
def _lines_for(bill_ids: list[int],
               enforce_eligibility: bool = True) -> tuple[list[BatchLine], list[dict]]:
    """Turn bill ids into voucher lines, and report the ones that must NOT go.

    ELIGIBILITY IS ENFORCED HERE, not in the UI. The export endpoints take a
    caller-supplied list of ids, so without this a bill that is still an
    unconfirmed machine guess - or one carrying a live duplicate warning -
    could be named in the request and reach Tally as a real payment. Only a
    human-confirmed ('approved') bill with no open duplicate is eligible.
    """
    conn = ctx("conn")
    if not bill_ids:
        return [], []
    qs = ",".join("?" * len(bill_ids))
    rows = conn.execute(
        f"""SELECT b.id, b.status, b.person AS bill_person, e.person, e.ledger,
                   e.net_amount, e.invoice_date, e.narration, e.vendor_name,
                   (SELECT COUNT(*) FROM duplicates d
                     WHERE d.bill_id = b.id AND d.overridden = 0) AS open_dupes,
                   EXISTS(SELECT 1 FROM export_bills x
                          WHERE x.bill_id = b.id) AS was_exported
            FROM bills b
            LEFT JOIN extractions e ON e.id =
                (SELECT MAX(id) FROM extractions WHERE bill_id = b.id)
            WHERE b.id IN ({qs}) ORDER BY b.id""", bill_ids).fetchall()
    out: list[BatchLine] = []
    blocked: list[dict] = []
    for r in rows:
        reasons = []
        # "already exported" must win over the status check: after an export the
        # bill IS 'posted', and that is the message a human needs to see.
        if r["was_exported"]:
            reasons.append("already exported to Tally in an earlier batch")
        elif r["status"] != "approved":
            reasons.append(f"status is '{r['status']}', not approved - "
                           "a person must confirm it first")
        if r["open_dupes"]:
            reasons.append("unresolved duplicate warning - override or reject it first")
        if reasons and enforce_eligibility:
            blocked.append({"bill_id": r["id"], "reasons": reasons})
            continue
        iso = _iso(r["invoice_date"])
        out.append(BatchLine(
            bill_id=r["id"],
            person=(r["person"] or r["bill_person"] or "").strip(),
            ledger=(r["ledger"] or "").strip(),
            amount=r["net_amount"] or 0,
            voucher_date=date.fromisoformat(iso) if iso else date.today(),
            narration=r["narration"] or "",
            vendor=r["vendor_name"] or "",
        ))
    return out, blocked


def _build(bill_ids: list[int]) -> dict:
    cfg = ctx("cfg")
    t = cfg["tally"]
    conn = ctx("conn")
    # A bill already sent to Tally by EITHER path is out: the batch exporter
    # records export_bills, while the single-bill dashboard post records only
    # vouchers. Checking one and not the other let the same bill reach the
    # books twice - a duplicate payment.
    exported = {r["bill_id"] for r in conn.execute(
        "SELECT bill_id FROM export_bills "
        "UNION SELECT bill_id FROM vouchers WHERE status IN ('posted','generated')")}
    lines, blocked = _lines_for(bill_ids)
    r = build_batch(
        lines, t["company"], ctx("known_ledgers")(),
        voucher_type=t.get("batch_voucher_type", "Journal"),
        cash_ledger=t.get("cash_ledger"),
        new_expense_parent=t["new_ledger_parent"],
        new_person_parent=t["new_person_parent"],
        company_gstin=t.get("company_gstin", ""),
        gst_registration=t.get("gst_registration", ""),
        gst_state=t.get("gst_state", ""),
        create_voucher_type=bool(t.get("create_voucher_type")),
        voucher_type_parent=t.get("voucher_type_parent", "Journal"),
        voucher_no_prefix=t.get("voucher_no_prefix", "REIMB"),
        already_exported=exported,
    )
    # Ineligible bills are REPORTED, never silently dropped: the preview is the
    # last cheap moment to notice that something a clerk ticked isn't going.
    r["skipped"] = blocked + r["skipped"]
    return r


def _consequences(r: dict, bill_ids: list[int]) -> dict:
    """What the file will do to Tally, in plain terms, before anyone imports it."""
    return {
        "requested": len(bill_ids),
        "vouchers": r["vouchers"],
        "total": r["total"],
        "new_ledgers": r["new_ledgers"],
        "new_voucher_type": r.get("new_voucher_type"),
        "skipped": r["skipped"],
        "voucher_numbers": [
            {"bill_id": l.bill_id,
             "voucher_no": voucher_number(
                 l.bill_id, l.voucher_date,
                 ctx("cfg")["tally"].get("voucher_no_prefix", "REIMB"))}
            for l in r["lines"]],
    }


@router.post("/export/preview")
async def export_preview(request: Request, user: str = Actor):
    """Dry run. Changes nothing, so the ERP can show a confirmation screen.

    This is the last point at which a mistake is cheap. Once the XML is in
    Tally, unwinding it is manual work in someone's evening - so the preview
    names every ledger that will be CREATED, not just the vouchers posted.
    """
    body = await request.json()
    bill_ids = [int(i) for i in (body.get("bill_ids") or [])]
    if not bill_ids:
        raise HTTPException(400, "bill_ids is required")
    return _consequences(_build(bill_ids), bill_ids)


@router.post("/export")
async def export(request: Request, user: str = Actor):
    """Generate ONE importable XML for up to 100+ bills, and record it.

    Recording is not bookkeeping for its own sake: because the batch posts under
    Tally's standard Journal, Tally will not reject a re-import, so the exports
    table IS the duplicate guard. A bill in it is excluded from every later
    batch, with the reason shown.
    """
    body = await request.json()
    bill_ids = [int(i) for i in (body.get("bill_ids") or [])]
    if not bill_ids:
        raise HTTPException(400, "bill_ids is required")

    conn, cfg = ctx("conn"), ctx("cfg")
    r = _build(bill_ids)
    if not r["vouchers"]:
        raise HTTPException(400, {"error": "Nothing to export",
                                 "skipped": r["skipped"]})

    ref = batch_filename()
    export_dir = Path(cfg["app"]["base_dir"]) / cfg["tally"]["export_dir"]
    export_dir.mkdir(parents=True, exist_ok=True)

    # DB row first, file second. Writing the file first meant a colliding ref
    # clobbered an earlier batch's XML on disk and only THEN failed on the
    # UNIQUE constraint - the books and the records disagreeing about what was
    # sent to Tally. Now a duplicate ref fails before anything is overwritten.
    cur = conn.execute(
        "INSERT INTO exports (ref, voucher_type, bill_count, total, "
        "new_ledgers_json, xml, created_by) VALUES (?,?,?,?,?,?,?)",
        (ref, cfg["tally"].get("batch_voucher_type", "Journal"), r["vouchers"],
         r["total"], json.dumps(r["new_ledgers"]), r["xml"], user))
    export_id = cur.lastrowid
    prefix = cfg["tally"].get("voucher_no_prefix", "REIMB")
    for l in r["lines"]:
        conn.execute(
            "INSERT OR IGNORE INTO export_bills (export_id, bill_id, "
            "voucher_no, amount) VALUES (?,?,?,?)",
            (export_id, l.bill_id,
             voucher_number(l.bill_id, l.voucher_date, prefix), l.amount))
    conn.executemany("UPDATE bills SET status='posted' WHERE id=?",
                     [(l.bill_id,) for l in r["lines"]])
    conn.commit()

    xml_path = export_dir / f"{ref}.xml"
    xml_path.write_text(r["xml"], encoding="utf-8")

    ctx("pipeline").log_event(
        "auto_post", f"{user} exported {r['vouchers']} voucher(s) totalling "
                     f"{r['total']:.2f} as {ref}"
                     + (f", creating {len(r['new_ledgers'])} ledger(s)"
                        if r["new_ledgers"] else ""))

    out = _consequences(r, bill_ids)
    out.update({
        "ok": True, "ref": ref, "export_id": export_id,
        "filename": f"{ref}.xml",
        "download_url": f"/api/v1/exports/{ref}/download",
        "import_instructions": [
            "Copy the file into the Tally machine's import folder.",
            "In Tally: O: Import -> Transactions.",
            "Give the full path to the .xml and press Enter.",
            "Check the result reads Errors : 0, then mark this export as "
            "imported in the ERP.",
        ],
    })
    return out


@router.get("/exports")
def list_exports(limit: int = 25, user: str = Actor):
    rows = ctx("conn").execute(
        "SELECT id, ref, voucher_type, bill_count, total, imported, "
        "imported_note, created_by, created_at FROM exports "
        "ORDER BY id DESC LIMIT ?", (max(1, min(limit, 200)),)).fetchall()
    return {"exports": [dict(r) | {"imported": bool(r["imported"])}
                        for r in rows]}


@router.get("/exports/{ref}")
def export_detail(ref: str, user: str = Actor):
    conn = ctx("conn")
    e = conn.execute("SELECT * FROM exports WHERE ref=?", (ref,)).fetchone()
    if not e:
        raise HTTPException(404, "Unknown export")
    bills = conn.execute(
        "SELECT bill_id, voucher_no, amount FROM export_bills "
        "WHERE export_id=? ORDER BY bill_id", (e["id"],)).fetchall()
    return {"ref": e["ref"], "voucher_type": e["voucher_type"],
            "bill_count": e["bill_count"], "total": e["total"],
            "new_ledgers": _loads(e["new_ledgers_json"]) or [],
            "imported": bool(e["imported"]), "imported_note": e["imported_note"],
            "created_by": e["created_by"], "created_at": e["created_at"],
            "bills": [dict(b) for b in bills],
            "download_url": f"/api/v1/exports/{ref}/download"}


@router.get("/exports/{ref}/download")
def download(ref: str, fmt: str = "xml", user: str = Actor):
    """Fetch the file. fmt=xml is the import; fmt=xlsx is a review sheet only.

    The distinction is enforced rather than explained: Tally's Excel import
    cannot create masters, so importing the .xlsx would fail confusingly on any
    batch containing a new ledger. The sheet exists to be read by humans.
    """
    conn, cfg = ctx("conn"), ctx("cfg")
    e = conn.execute("SELECT * FROM exports WHERE ref=?", (ref,)).fetchone()
    if not e:
        raise HTTPException(404, "Unknown export")
    export_dir = Path(cfg["app"]["base_dir"]) / cfg["tally"]["export_dir"]
    export_dir.mkdir(parents=True, exist_ok=True)

    if fmt == "xlsx":
        rows = conn.execute("SELECT bill_id FROM export_bills WHERE export_id=?",
                            (e["id"],)).fetchall()
        path = export_dir / f"{ref}_REVIEW_ONLY.xlsx"
        # eligibility is not re-applied here: this sheet REVIEWS an export that
        # already happened, so its bills are 'posted' by definition.
        build_batch_excel(_lines_for([r["bill_id"] for r in rows],
                                     enforce_eligibility=False)[0], path,
                          _loads(e["new_ledgers_json"]) or [])
        return FileResponse(path, filename=path.name)

    path = export_dir / f"{ref}.xml"
    if not path.exists():          # regenerate from the stored copy
        path.write_text(e["xml"], encoding="utf-8")
    return FileResponse(path, media_type="application/xml",
                        filename=f"{ref}.xml")


@router.post("/exports/{ref}/mark-imported")
async def mark_imported(ref: str, request: Request, user: str = Actor):
    """Record that Tally accepted the file.

    Deliberately a human confirmation, not an assumption. In file mode the
    engine never learns the outcome by itself, and quietly showing exports as
    "in Tally" when nobody checked would make the ERP's records confidently
    wrong - worse than showing nothing.
    """
    body = await request.json() if await request.body() else {}
    conn = ctx("conn")
    n = conn.execute(
        "UPDATE exports SET imported=1, imported_note=? WHERE ref=?",
        (f"{user}: {str(body.get('note') or 'confirmed imported')}", ref))
    if not n.rowcount:
        raise HTTPException(404, "Unknown export")
    conn.commit()
    return {"ok": True, "ref": ref, "imported": True}


@router.post("/exports/{ref}/void")
async def void_export(ref: str, request: Request, user: str = Actor):
    """Release a batch that Tally rejected, or that was never imported.

    Bills are locked the moment the XML is generated, which is right - it stops
    tomorrow's batch sweeping up the same claim. But Tally can refuse a file
    (a bad ledger name, a closed period), and without this the bills stayed
    locked forever with no way back: the reimbursement simply never happened
    and nobody could re-export it.

    Refused once the export is marked imported. At that point the vouchers are
    in the books and must be reversed in Tally, not unpicked here.
    """
    body = await request.json() if await request.body() else {}
    reason = str(body.get("reason") or "").strip()
    if len(reason) < 4:
        raise HTTPException(400, "A reason is required to void an export")
    conn = ctx("conn")
    e = conn.execute("SELECT * FROM exports WHERE ref=?", (ref,)).fetchone()
    if not e:
        raise HTTPException(404, "Unknown export")
    if e["imported"]:
        raise HTTPException(
            409, "This export is marked imported in Tally - reverse the "
                 "vouchers in Tally instead of voiding here.")
    bill_ids = [r["bill_id"] for r in conn.execute(
        "SELECT bill_id FROM export_bills WHERE export_id=?", (e["id"],))]
    conn.execute("DELETE FROM export_bills WHERE export_id=?", (e["id"],))
    conn.executemany("UPDATE bills SET status='approved' WHERE id=? AND status='posted'",
                     [(b,) for b in bill_ids])
    conn.execute("UPDATE exports SET imported_note=? WHERE id=?",
                 (f"VOIDED by {user}: {reason}", e["id"]))
    conn.commit()
    ctx("pipeline").log_event(
        "auto_post", f"{user} voided export {ref} ({len(bill_ids)} bill(s) "
                     f"released back to approved): {reason}")
    return {"ok": True, "ref": ref, "released": len(bill_ids)}


# --------------------------------------------------------------------------
# Ledger requests + insights
# --------------------------------------------------------------------------
@router.post("/ledger-requests")
async def ledger_request(request: Request, user: str = Actor):
    """Ask for a ledger that does not exist yet.

    A clerk can also just type the name at confirm time and the export will
    create it - but that puts chart-of-accounts decisions in the hands of
    whoever is clearing the fastest. This route lets the ERP route it to someone
    who owns the chart instead.
    """
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    conn = ctx("conn")
    cur = conn.execute(
        "INSERT INTO ledger_requests (bill_id, name, parent, reason, created_by) "
        "VALUES (?,?,?,?,?)",
        (body.get("bill_id"), name,
         str(body.get("parent") or ctx("cfg")["tally"]["new_ledger_parent"]),
         str(body.get("reason") or ""), user))
    conn.commit()
    return {"ok": True, "id": cur.lastrowid, "name": name, "status": "pending"}


@router.get("/insights")
def insights(user: str = Actor):
    """What the system can say about its own accuracy, from its own tables."""
    from . import agent as agent_mod
    return agent_mod.insights(ctx("conn"), ctx("ledgers"))


@router.get("/events")
def events(limit: int = 50, kind: str = "", user: str = Actor):
    """The agent's journal - what it did without being asked."""
    sql = "SELECT * FROM agent_events"
    params: list = []
    if kind:
        sql += " WHERE kind = ?"
        params.append(kind)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    return {"events": [dict(r) for r in ctx("conn").execute(sql, params)]}

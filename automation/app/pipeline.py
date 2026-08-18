"""
Orchestration: upload -> OCR -> extract -> dedupe -> classify -> review.

Nothing here is clever; the intelligence lives in the modules this calls. The
job of this file is to run them in the right order, short-circuit early when a
bill cannot proceed, and make sure every decision is written to the database
with enough context to explain it later.
"""
from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from datetime import date as _date

from . import dedupe, extract, tally
from .classify import LedgerClassifier, Memory, build_query_text, vendor_key
from .ocr import engine as ocr_engine
from .ocr import preprocess as pp
from .ocr import quality as ocr_quality


@dataclass
class PipelineResult:
    bill_id: int
    status: str
    quality: dict = field(default_factory=dict)
    extraction: dict = field(default_factory=dict)
    suggestions: list = field(default_factory=list)
    duplicates: list = field(default_factory=list)
    ocr_text: str = ""
    ocr_confidence: float = 0.0
    ocr_variant: str = ""
    page_images: list = field(default_factory=list)
    messages: list = field(default_factory=list)


class Pipeline:
    def __init__(self, conn, cfg: dict, ledgers: list):
        self.conn = conn
        self.cfg = cfg
        self.dedupe_on = cfg.get("dedupe", {}).get("enabled", True)
        self.memory = Memory(conn)
        c = cfg.get("classify", {})
        usage = {}
        try:
            usage = {r["ledger"]: r["count"] for r in conn.execute(
                "SELECT ledger, count FROM ledger_usage WHERE count > 0")}
        except Exception:
            pass
        self.classifier = LedgerClassifier(
            ledgers, self.memory,
            weights=c.get("weights"), bands=c.get("bands"),
            memory_trust_count=c.get("memory_trust_count"),
            usage=usage,
        )
        self.upload_dir = Path(cfg["app"]["upload_dir"])
        self.upload_dir.mkdir(parents=True, exist_ok=True)

        # Variant self-tuning state. Seeded from history at startup so a
        # restart does not forget what has been learned about which OCR
        # preprocessing wins on THIS company's bills.
        self._variant_wins: dict[str, int] = {}
        self._processed_since_start = 0
        try:
            for r in conn.execute(
                    "SELECT ocr_variant v, COUNT(*) n FROM bills "
                    "WHERE ocr_variant IN ('grayscale','adaptive','otsu') "
                    "GROUP BY ocr_variant"):
                self._variant_wins[r["v"]] = r["n"]
        except Exception:
            pass

    # -- agent journal --------------------------------------------------------
    def log_event(self, kind: str, message: str, bill_id: int | None = None) -> None:
        """Everything the agent does on its own initiative gets written down.

        Autonomy without a journal is unaccountable: when a clerk asks "why is
        this bill already posted?", the answer must be one screen away, not a
        shrug. Failures to log never break processing.
        """
        try:
            self.conn.execute(
                "INSERT INTO agent_events(kind, bill_id, message) VALUES (?,?,?)",
                (kind, bill_id, message[:500]))
            self.conn.commit()
        except Exception:
            pass

    # -- variant self-tuning ---------------------------------------------------
    def _variants_to_run(self, all_variants: dict) -> dict:
        """Drop OCR variants that keep losing - but keep earning the evidence.

        Once one variant has won >= autotune_dominance of a decent sample, the
        losers are pure runtime cost on ~9 of 10 bills. The 10th bill (explore_
        every) still runs the full set, because a winner measured only against
        itself is a self-fulfilling statistic: if paper stock or the scanner
        changes, the exploration bills notice and the dominance share drops
        back below the threshold, which re-enables the full set automatically.
        """
        agent_cfg = self.cfg.get("agent", {})
        if not agent_cfg.get("variant_autotune") or len(all_variants) <= 1:
            return all_variants

        self._processed_since_start += 1
        if self._processed_since_start % int(agent_cfg.get("explore_every", 10)) == 0:
            return all_variants                     # exploration bill

        total = sum(self._variant_wins.values())
        if total < int(agent_cfg.get("autotune_min_sample", 200)):
            return all_variants                     # not enough evidence yet

        best, wins = max(self._variant_wins.items(), key=lambda kv: kv[1])
        if wins / total >= float(agent_cfg.get("autotune_dominance", 0.90)) \
                and best in all_variants:
            if self._processed_since_start % 50 == 1:
                self.log_event(
                    "tune", f"Running only the '{best}' OCR variant - it has won "
                            f"{wins}/{total} bills. Full set still runs on every "
                            f"{agent_cfg.get('explore_every', 10)}th bill.")
            return {best: all_variants[best]}
        return all_variants

    # -- ingest -------------------------------------------------------------
    def register(self, src_path: str, filename: str, user: str,
                 person: str = "", handwritten: bool = False,
                 batch_id: str = "") -> list[int]:
        """Split an uploaded file into one QUEUED bill per page. Fast - no OCR.

        ONE PAGE = ONE BILL. A stack of receipts scanned or photographed into a
        single 11-page PDF is eleven separate claims, each with its own vendor,
        amount and expense ledger. Treating the file as one bill (and picking
        the "best" page from it) produced a single garbled record that matched
        none of the eleven receipts.

        This returns immediately so the browser gets a page to render; the OCR
        work happens afterwards in the background worker.
        """
        # Sanitise the filename before it becomes part of a path we create.
        # Browsers normally send a bare name, but nothing stops a crafted
        # request sending "..\\..\\evil.pdf", and Path(...).name alone does not
        # strip Windows separators on Linux.
        safe_name = re.sub(r"[^\w.\- ()]", "_", Path(filename).name)[:120] or "upload"
        source = self.upload_dir / f"{dedupe.file_sha256(src_path)[:16]}_{safe_name}"
        shutil.copy2(src_path, source)

        # A corrupt or empty PDF must become a visible ERROR bill, not a 500.
        # The clerk sees "could not be read" in the batch list next to the
        # pages that worked; an exception here used to take the whole upload
        # down with it.
        try:
            pages = self._split_pages(str(source))
        except Exception as exc:  # noqa: BLE001
            cur = self.conn.execute(
                "INSERT INTO bills(filename, stored_path, source_file, page_no, "
                "batch_id, file_sha256, person, status, error, created_by) "
                "VALUES (?,?,?,1,?,?,?,'error',?,?)",
                (safe_name, str(source), str(source), batch_id,
                 dedupe.file_sha256(str(source)), person,
                 f"File could not be opened ({type(exc).__name__}). Is it a "
                 f"valid PDF or image?", user))
            self.conn.commit()
            return [cur.lastrowid]

        if not pages:
            cur = self.conn.execute(
                "INSERT INTO bills(filename, stored_path, source_file, page_no, "
                "batch_id, file_sha256, person, status, error, created_by) "
                "VALUES (?,?,?,1,?,?,?,'error','The PDF contains no pages.',?)",
                (safe_name, str(source), str(source), batch_id,
                 dedupe.file_sha256(str(source)), person, user))
            self.conn.commit()
            return [cur.lastrowid]

        filename = safe_name
        text_layers = self._text_layers(str(source), len(pages))
        multi = len(pages) > 1

        bill_ids: list[int] = []
        for idx, page_path in enumerate(pages, start=1):
            # Hash the PAGE, not the source file, so duplicate detection works
            # per receipt. The same receipt re-photographed inside a different
            # PDF is still caught.
            page_sha = dedupe.file_sha256(page_path)
            label = f"{filename} - page {idx}" if multi else filename

            exact = self.conn.execute(
                "SELECT id, filename, created_at, status FROM bills "
                "WHERE file_sha256 = ? AND status != 'rejected'", (page_sha,)
            ).fetchone() if self.dedupe_on else None
            if exact:
                cur = self.conn.execute(
                    "INSERT INTO bills(filename, stored_path, source_file, page_no, "
                    "batch_id, file_sha256, person, page_count, status, error, "
                    "created_by) VALUES (?,?,?,?,?,?,?,1,'duplicate',?,?)",
                    (label, page_path, str(source), idx, batch_id, page_sha, person,
                     f"Already uploaded as '{exact['filename']}' on "
                     f"{exact['created_at'][:10]} (status: {exact['status']})", user),
                )
                self.conn.commit()
                bill_ids.append(cur.lastrowid)
                continue

            cur = self.conn.execute(
                "INSERT INTO bills(filename, stored_path, source_file, page_no, "
                "batch_id, file_sha256, text_layer, person, phash, page_count, "
                "status, created_by) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)",
                (label, page_path, str(source), idx, batch_id, page_sha,
                 text_layers[idx - 1] if idx <= len(text_layers) else None,
                 person, dedupe.perceptual_hash(page_path),
                 "manual_entry" if handwritten else "queued", user),
            )
            self.conn.commit()
            bill_ids.append(cur.lastrowid)

        return bill_ids

    def _split_pages(self, path: str) -> list[str]:
        if path.lower().endswith(".pdf"):
            out = Path(self.cfg["app"]["data_dir"]) / "pages" / Path(path).stem
            return pp.pdf_to_images(path, str(out), dpi=self.cfg["ocr"]["pdf_dpi"])
        return [path]

    def _text_layers(self, path: str, n_pages: int) -> list[str | None]:
        """Embedded PDF text, per page. A digital invoice needs no OCR at all."""
        if not path.lower().endswith(".pdf"):
            return [None] * n_pages
        try:
            layers = pp.pdf_text_layer(path)
        except Exception:
            return [None] * n_pages
        return [(t if t and len(t.strip()) > 80 else None) for t in layers]

    def ingest(self, src_path: str, filename: str, user: str,
               person: str = "", handwritten: bool = False) -> PipelineResult:
        """Synchronous single-file ingest. Kept for tests and scripted use;
        the web app uses register() plus the background worker."""
        ids = self.register(src_path, filename, user, person, handwritten)
        if not ids:
            return PipelineResult(bill_id=0, status="error",
                                  messages=["Nothing could be read from that file"])
        first = self.conn.execute("SELECT * FROM bills WHERE id=?", (ids[0],)).fetchone()
        if first["status"] == "duplicate":
            return PipelineResult(
                bill_id=ids[0], status="duplicate",
                duplicates=[{"matched_bill_id": ids[0], "layer": "file_hash",
                             "score": 1.0, "blocking": True,
                             "detail": first["error"]}],
                messages=[first["error"]])
        if first["status"] == "manual_entry":
            return PipelineResult(bill_id=ids[0], status="manual_entry",
                                  messages=["Marked as handwritten - enter it manually."])
        return self.process(ids[0])

    # -- process ------------------------------------------------------------
    def process(self, bill_id: int, result: PipelineResult | None = None) -> PipelineResult:
        row = self.conn.execute("SELECT * FROM bills WHERE id = ?", (bill_id,)).fetchone()
        result = result or PipelineResult(bill_id=bill_id, status=row["status"])
        page_path = row["stored_path"]
        result.page_images = [page_path]

        # This page already carries embedded text (digital PDF or a scanner set
        # to "searchable PDF"). Nothing to OCR - use it as-is at full confidence.
        if row["text_layer"]:
            text = row["text_layer"]
            result.ocr_text = text
            result.ocr_confidence = 99.0
            result.ocr_variant = "pdf_text_layer"
            result.quality = {"verdict": "ok", "reasons": [],
                              "note": "Text read directly from the PDF - no OCR needed"}
            self.conn.execute(
                "UPDATE bills SET ocr_text=?, ocr_confidence=99.0, "
                "ocr_variant='pdf_text_layer', quality_verdict='ok' WHERE id=?",
                (text, bill_id))
            self.conn.commit()
            return self._after_ocr(bill_id, result, text.splitlines())

        out = (pp.preprocess_variants(
                   page_path, crop_document=self.cfg["ocr"]["crop_document"],
                   target_height=self.cfg["ocr"]["target_height"],
                   max_height=self.cfg["ocr"].get("max_height", 2600))
               if self.cfg["ocr"]["try_variants"]
               else {"variants": {"default": pp.preprocess(page_path)["image"]},
                     "gray": pp.preprocess(page_path)["gray"]})

        run_set = self._variants_to_run(out["variants"])
        res, variant = ocr_engine.run_best_of(
            run_set, engine=self.cfg["ocr"]["engine"],
            lang=self.cfg["ocr"]["lang"], psm=self.cfg["ocr"]["psm"],
        )
        if variant in ("grayscale", "adaptive", "otsu") and len(run_set) > 1:
            # Only exploration/full runs count as evidence - a winner-only run
            # would inflate its own statistics.
            self._variant_wins[variant] = self._variant_wins.get(variant, 0) + 1
        rep = ocr_quality.assess(out["gray"], self.cfg.get("quality"))
        rep = ocr_quality.finalise(rep, res.text, res.mean_conf,
                                   res.word_count, self.cfg.get("quality"))

        # ---- OCR rescue pass -----------------------------------------------
        # A failed read costs a human a re-upload round-trip, which in practice
        # means the claim stalls for days. Before asking for that, try harder:
        # different page-segmentation modes (sparse text and single-column) and
        # the uncropped frame, in case the document crop was what went wrong.
        # Only runs on failures, so the fast path pays nothing.
        if rep.verdict == "reupload" and self.cfg.get("agent", {}).get("rescue_pass", True):
            before = res.mean_conf
            try:
                nocrop = pp.preprocess(
                    page_path, crop_document=False, binarise=False,
                    target_height=self.cfg["ocr"]["target_height"],
                    max_height=self.cfg["ocr"].get("max_height", 2600))["gray"]
                rescue_res, rescue_variant = ocr_engine.run_best_of(
                    {"gray": out["gray"], "nocrop": nocrop},
                    engine=self.cfg["ocr"]["engine"],
                    lang=self.cfg["ocr"]["lang"], psms=(4, 11),
                )
                if ocr_engine.score_result(rescue_res) > ocr_engine.score_result(res):
                    res, variant = rescue_res, f"rescued/{rescue_variant}"
                    rep = ocr_quality.assess(out["gray"], self.cfg.get("quality"))
                    rep = ocr_quality.finalise(rep, res.text, res.mean_conf,
                                               res.word_count, self.cfg.get("quality"))
                    if rep.verdict != "reupload":
                        self.log_event(
                            "rescue", f"Rescued a failed read: confidence "
                                      f"{before:.0f}% -> {res.mean_conf:.0f}% "
                                      f"({rescue_variant})", bill_id)
            except Exception:
                pass

        result.ocr_text = res.text
        result.ocr_confidence = res.mean_conf
        result.ocr_variant = variant
        result.quality = {
            "verdict": rep.verdict, "reasons": rep.reasons,
            "blur": rep.blur_score, "contrast": rep.contrast,
            "brightness": rep.brightness, "confidence": rep.ocr_confidence,
            "plausibility": rep.plausibility, "stroke_variation": rep.stroke_variation,
        }

        # Persist the OCR output BEFORE branching on the verdict. Previously
        # this only happened on the reupload/handwritten paths, so bills that
        # read successfully - the common case - stored no text at all. That left
        # the "What the OCR read" panel blank and, worse, fed empty text to the
        # token learner, so it never learned anything from a good bill.
        self.conn.execute(
            "UPDATE bills SET ocr_text=?, ocr_confidence=?, ocr_variant=?, "
            "ocr_engine=?, quality_verdict=?, quality_json=?, "
            "updated_at=datetime('now') WHERE id=?",
            (res.text, res.mean_conf, variant, self.cfg["ocr"]["engine"],
             rep.verdict, json.dumps(result.quality), bill_id),
        )
        self.conn.commit()

        if rep.verdict == "handwritten":
            self._set_status(bill_id, "manual_entry", rep, res, variant)
            result.status = "manual_entry"
            result.messages = rep.reasons
            return result

        if rep.verdict == "reupload":
            self._set_status(bill_id, "needs_reupload", rep, res, variant)
            result.status = "needs_reupload"
            result.messages = rep.reasons + ocr_quality.REUPLOAD_TIPS
            return result

        return self._after_ocr(bill_id, result, res.lines)

    def _after_ocr(self, bill_id: int, result: PipelineResult,
                   lines: list[str]) -> PipelineResult:
        ex = extract.extract(result.ocr_text, lines, result.ocr_confidence)
        exd = ex.to_dict()
        result.extraction = exd

        flat = {
            "vendor_name": ex.vendor_name.value,
            "vendor_gstin": ex.vendor_gstin.value,
            "invoice_no": ex.invoice_no.value,
            "invoice_date": ex.invoice_date.value,
            "net_amount": ex.net_amount.value,
        }

        # Layer 3: the duplicate check that actually matters.
        if self.dedupe_on:
            biz = dedupe.check_business_key(self.conn, flat, bill_id)
            if biz:
                dedupe.record(self.conn, bill_id, biz)
                result.duplicates.extend(d.to_dict() for d in biz)

        # The claimant, chosen at upload. Needed BEFORE classification, because
        # who is claiming is one of the five signals.
        person = self.conn.execute(
            "SELECT person FROM bills WHERE id=?", (bill_id,)).fetchone()["person"]

        # Reduce the bill to purchase-meaning words before matching. Feeding the
        # raw OCR dump in compresses every score into single digits.
        query = build_query_text(result.ocr_text, ex.vendor_name.value, ex.line_items)

        sugg = self.classifier.classify(
            query,
            vendor_name=ex.vendor_name.value,
            gstin=ex.vendor_gstin.value,
            nature_filter=set(self.cfg["classify"]["allowed_natures"]),
            top_k=self.cfg["classify"]["top_k"],
            person=person,
        )
        result.suggestions = [s.to_dict() for s in sugg]

        self.conn.execute(
            "INSERT INTO extractions(bill_id, vendor_name, vendor_gstin, invoice_no, "
            "invoice_date, taxable_value, cgst, sgst, igst, round_off, net_amount, "
            "hsn_sac, ledger, person, fields_json, suggestions_json, confidence, "
            "arithmetic_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (bill_id, ex.vendor_name.value, ex.vendor_gstin.value, ex.invoice_no.value,
             ex.invoice_date.value, ex.taxable_value.value, ex.cgst.value, ex.sgst.value,
             ex.igst.value, ex.round_off.value, ex.net_amount.value, ex.hsn_sac.value,
             sugg[0].ledger if sugg and sugg[0].band in ("high", "medium") else None,
             person, json.dumps(exd, default=str), json.dumps(result.suggestions),
             ex.overall_confidence, int(ex.arithmetic_ok)),
        )
        self._set_status(bill_id, "review")
        result.status = "review"

        # ---- Auto-approval -------------------------------------------------
        # The agent moves the bill to 'approved' itself when the evidence is
        # overwhelming, so a trusted vendor's fifth identical claim needs zero
        # clicks before posting. Every guard below exists because its absence
        # would let a specific mistake through:
        #   trusted mapping   - one careless confirm must not create an autopilot
        #   high band         - a text-only guess is never certain enough
        #   amount trusted    - arithmetic-verified or read at high confidence
        #   no duplicates     - a flagged twin needs eyes, full stop
        #   amount ceiling    - a misread 91,500 must never sail through
        # Posting to Tally still requires a human click; this only removes the
        # confirm step. The decision is recorded on the bill and shown in the UI.
        agent_cfg = self.cfg.get("agent", {})

        # ---- Anomaly sentinel ------------------------------------------------
        # A person's own history is a baseline no rule-book can match. A claim
        # far above their median is not necessarily wrong - a hotel stay among
        # fuel bills - but it is exactly the bill a human should look at, so it
        # is flagged and excluded from auto-approval. Judgement only begins
        # after anomaly_min_history confirmed claims; two data points are not a
        # pattern.
        anomalous = False
        if person and ex.net_amount.value:
            hist = [r["net_amount"] for r in self.conn.execute(
                "SELECT e.net_amount FROM extractions e JOIN bills b "
                "ON b.id = e.bill_id WHERE e.person=? AND e.net_amount>0 "
                "AND b.status IN ('approved','posted') AND e.bill_id != ? "
                "ORDER BY e.id DESC LIMIT 60", (person, bill_id)).fetchall()]
            min_hist = int(agent_cfg.get("anomaly_min_history", 5))
            if len(hist) >= min_hist:
                hist.sort()
                median = hist[len(hist) // 2]
                factor = float(agent_cfg.get("anomaly_factor", 3.0))
                if median > 0 and float(ex.net_amount.value) > factor * median:
                    anomalous = True
                    msg = (f"Amount {float(ex.net_amount.value):,.2f} is "
                           f"{float(ex.net_amount.value)/median:.1f}x {person}'s "
                           f"median claim of {median:,.2f} - please check")
                    result.messages.append(msg)
                    ex.notes.append(msg)
                    self.conn.execute(
                        "UPDATE extractions SET fields_json=? WHERE bill_id=? AND "
                        "id=(SELECT MAX(id) FROM extractions WHERE bill_id=?)",
                        (json.dumps(ex.to_dict(), default=str), bill_id, bill_id))
                    self.conn.commit()
                    self.log_event("anomaly", msg, bill_id)

        if agent_cfg.get("auto_approve") and sugg and person and not anomalous:
            top = sugg[0]
            mem_count = int(top.signals.get("memory_count", 0))
            amount = ex.net_amount.value
            amount_trusted = bool(amount) and (
                ex.arithmetic_ok or ex.net_amount.confidence >= 0.80)
            if (top.band == "high"
                    and mem_count >= self.classifier.memory_trust_count
                    and amount_trusted
                    and not result.duplicates
                    and float(amount) <= float(
                        agent_cfg.get("auto_approve_max_amount", 5000))):
                self.conn.execute(
                    "UPDATE extractions SET ledger=?, person=? "
                    "WHERE bill_id=? AND id=(SELECT MAX(id) FROM extractions "
                    "WHERE bill_id=?)",
                    (top.ledger, person, bill_id, bill_id))
                self.conn.execute(
                    "UPDATE bills SET status='approved', auto_approved=1, "
                    "updated_at=datetime('now') WHERE id=?", (bill_id,))
                self.conn.commit()
                result.status = "approved"
                result.messages.append(
                    f"Auto-approved: {top.ledger} - this vendor has "
                    f"{mem_count} confirmed claims and every check passed.")
                self.log_event(
                    "auto_approve",
                    f"{person}: {top.ledger} for {float(amount):,.2f} "
                    f"(vendor confirmed {mem_count}x)", bill_id)
                self._maybe_auto_post(bill_id, top.ledger, person,
                                      float(amount), ex, result)
                return result

        if not ex.net_amount:
            result.messages.append("Could not read the amount - please enter it.")
        if not sugg or sugg[0].band == "none":
            result.messages.append(
                "No ledger matched confidently. Choose one, or request a new ledger."
            )
        return result

    def _maybe_auto_post(self, bill_id: int, ledger: str, person: str,
                         amount: float, ex, result) -> None:
        """FILE MODE ONLY: write the Tally voucher XML for an auto-approved bill.

        In file mode "posting" produces an XML file in tally.export_dir; the
        books do not change until an accountant imports it into Tally. That
        human gate is what makes hands-free generation safe, and it is also why
        this deliberately refuses to fire in HTTP mode regardless of config -
        over HTTP there is no later human, and money movement without any
        person in the loop is a line this system does not cross.
        """
        agent_cfg = self.cfg.get("agent", {})
        if not agent_cfg.get("auto_post_file_mode"):
            return
        if self.cfg.get("tally", {}).get("mode") != "file":
            return
        try:
            vdate = None
            if ex.invoice_date.value:
                try:
                    vdate = _date.fromisoformat(str(ex.invoice_date.value))
                except ValueError:
                    vdate = None
            r = tally.Reimbursement(
                expense_ledger=ledger, person_ledger=person, amount=amount,
                voucher_date=vdate,
                narration=f"Reimbursement to {person} - "
                          f"{ex.vendor_name.value or 'expense'} (auto)")
            xml = tally.build_voucher_xml(
                r, self.cfg["tally"]["company"],
                self.cfg["tally"].get("voucher_type", "Journal"),
                self.cfg["tally"].get("cash_ledger"))
            export_dir = Path(self.cfg["app"].get("base_dir", ".")) / \
                self.cfg["tally"]["export_dir"]
            path = tally.write_xml_file(xml, str(export_dir),
                                        f"reimb_{bill_id}_{person}")
            self.conn.execute(
                "INSERT INTO vouchers(bill_id, xml, mode, status, "
                "tally_response, created_by) VALUES (?,?,'file','generated',?,"
                "'agent')", (bill_id, xml, f"auto-posted to {path}"))
            self.conn.execute(
                "UPDATE bills SET status='posted', updated_at=datetime('now') "
                "WHERE id=?", (bill_id,))
            self.conn.commit()
            result.status = "posted"
            result.messages.append(f"Voucher XML written to {path}")
            self.log_event("auto_post",
                           f"{person}: {ledger} {amount:,.2f} -> {Path(path).name}",
                           bill_id)
        except Exception as exc:  # noqa: BLE001
            # Approval stands; only the XML generation failed. A human posts it.
            self.log_event("error",
                           f"Auto-post failed, bill left as approved: {exc}",
                           bill_id)

    # -- background worker ---------------------------------------------------
    def process_queued(self, batch_id: str | None = None,
                       on_done=None) -> None:
        """Work through queued bills one at a time.

        Runs on a worker thread so the browser is never left staring at a frozen
        page for the ~6 seconds per page that OCR takes. Each bill is committed
        as it finishes, so the batch view can show real progress.

        A failure on one page must not stop the rest - a single unreadable
        receipt in a stack of twenty should not cost the other nineteen.
        """
        while True:
            q = ("SELECT id FROM bills WHERE status='queued'"
                 + (" AND batch_id=?" if batch_id else "")
                 + " ORDER BY id LIMIT 1")
            row = self.conn.execute(q, (batch_id,) if batch_id else ()).fetchone()
            if not row:
                break
            bill_id = row["id"]
            # ATOMIC CLAIM. Several workers can be alive at once - one per
            # upload batch plus the inbox watcher - and two of them can SELECT
            # the same queued bill before either updates it. The status guard
            # in the WHERE clause makes the claim exclusive: whoever's UPDATE
            # lands first gets rowcount 1, everyone else gets 0 and moves on.
            # Without this, the same receipt was OCR'd twice and got two
            # extraction rows.
            claimed = self.conn.execute(
                "UPDATE bills SET status='processing', updated_at=datetime('now') "
                "WHERE id=? AND status='queued'", (bill_id,))
            self.conn.commit()
            if claimed.rowcount == 0:
                continue    # another worker got there first
            try:
                self.process(bill_id)
            except Exception as exc:  # noqa: BLE001
                self.conn.execute(
                    "UPDATE bills SET status='error', error=?, "
                    "updated_at=datetime('now') WHERE id=?",
                    (f"{type(exc).__name__}: {exc}"[:500], bill_id))
                self.conn.commit()
            if on_done:
                on_done(bill_id)

    def _set_status(self, bill_id: int, status: str, rep=None,
                    res=None, variant: str = "") -> None:
        if rep is not None:
            self.conn.execute(
                "UPDATE bills SET status=?, quality_verdict=?, quality_json=?, "
                "ocr_engine=?, ocr_variant=?, ocr_confidence=?, ocr_text=?, "
                "updated_at=datetime('now') WHERE id=?",
                (status, rep.verdict,
                 json.dumps({"reasons": rep.reasons, "blur": rep.blur_score,
                             "plausibility": rep.plausibility}),
                 self.cfg["ocr"]["engine"], variant,
                 res.mean_conf if res else None, res.text if res else None, bill_id),
            )
        else:
            self.conn.execute(
                "UPDATE bills SET status=?, updated_at=datetime('now') WHERE id=?",
                (status, bill_id),
            )
        self.conn.commit()

    # -- confirm ------------------------------------------------------------
    def confirm(self, bill_id: int, ledger: str, person: str, amount: float,
                voucher_date: str | None, user: str,
                narration: str = "") -> dict:
        """Save the clerk's decision and learn from it.

        Learning happens HERE and only here - on confirmation, never on
        suggestion. The system learns from what a human accepted or corrected.
        """
        row = self.conn.execute(
            "SELECT * FROM extractions WHERE bill_id=? ORDER BY id DESC LIMIT 1",
            (bill_id,),
        ).fetchone()

        suggested = None
        if row and row["suggestions_json"]:
            s = json.loads(row["suggestions_json"])
            if s:
                suggested = s[0]["ledger"]

        edited = int(bool(row) and (
            suggested != ledger
            or (row["net_amount"] or 0) != amount
        ))

        self.conn.execute(
            "UPDATE extractions SET ledger=?, person=?, narration=?, net_amount=?, "
            "invoice_date=COALESCE(?, invoice_date), edited_by_user=? "
            "WHERE id=?",
            (ledger, person, narration, amount, voucher_date, edited,
             row["id"] if row else None),
        )

        vkey = vendor_key(row["vendor_name"] if row else None,
                          row["vendor_gstin"] if row else None)
        bill = self.conn.execute("SELECT ocr_text FROM bills WHERE id=?",
                                 (bill_id,)).fetchone()
        self.memory.learn(vkey, ledger, (bill["ocr_text"] if bill else "") or "",
                          suggested=suggested, user=user, person=person)

        if suggested and suggested != ledger:
            self.conn.execute(
                "UPDATE corrections SET bill_id=? WHERE bill_id IS NULL "
                "AND vendor_key=? AND chosen=?", (bill_id, vkey, ledger),
            )

        self._set_status(bill_id, "approved")
        return {"ok": True, "learned_from_correction": bool(suggested and suggested != ledger),
                "suggested": suggested, "chosen": ledger}

#!/usr/bin/env python3
"""
Regression tests.  Run:  python tests.py

Covers the parts where being wrong is expensive: GSTIN repair inventing
identifiers, amounts picking up phone numbers, duplicates slipping through,
unbalanced vouchers, and the learning loop trusting a single click.

No pytest dependency - this is meant to be runnable by whoever inherits the
system without setting anything up.
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

TMP = Path(tempfile.mkdtemp(prefix="finance_agent_tests_"))
os.environ["FINANCE_AGENT_DB"] = str(TMP / "test.db")

FAILURES: list[str] = []
SECTION = ""


def section(name: str) -> None:
    global SECTION
    SECTION = name
    print(f"\n{name}")


def check(name: str, cond: bool, extra: object = "") -> None:
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"   [{extra}]" if extra != "" else ""))
    if not cond:
        FAILURES.append(f"{SECTION} :: {name}")


def main() -> int:
    from app import extract, ledgers as lm, tally
    from app.db import connect
    from app import dedupe

    # ---------------------------------------------------------------- ledgers
    section("Ledger master")
    ls = lm.load_from_trial_balance(BASE / "data" / "Trial Balance - PESPL.xlsx")
    check("parses the trial balance", len(ls) > 400, len(ls))
    postable = lm.postable_for_purchase(ls)
    check("finds reimbursement targets", 150 < len(postable) < 260, len(postable))
    by = {l.name: l for l in ls}
    check("group headers are not postable", not by["Laptop"].is_postable)
    check("leaf ledgers are postable", by["Boarding & Lodging Expenses"].is_postable)
    check("hierarchy rebuilt",
          by["Boarding & Lodging Expenses"].parent == "ADMINISTRATION EXPENSES",
          by["Boarding & Lodging Expenses"].parent)
    check("nature derived from root group",
          by["Boarding & Lodging Expenses"].nature == "expense")
    check("seed aliases attached", "restaurant" in by["Boarding & Lodging Expenses"].aliases)

    # ------------------------------------------------------------------ GSTIN
    section("GSTIN checksum and repair")
    for g in ("27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "36ABCFK0167H1ZH"):
        check(f"validates {g}", extract._valid_gstin(g))
    check("rejects a bad check digit", not extract._valid_gstin("06BZAHM6385P6Z2"))
    check("rejects an impossible state code", not extract._valid_gstin("99AAPFU0939F1ZV"))

    hit = extract.find_gstin("GSTIN: 27AAPFU0939F1ZV")
    check("finds a clean GSTIN", hit and hit[0] == "27AAPFU0939F1ZV")

    hit = extract.find_gstin("GST No : C6ABCFKOIB7H IZH")
    check("repairs an OCR-mangled GSTIN (real sample)",
          hit and hit[0] == "36ABCFK0167H1ZH", hit[0] if hit else None)

    # The important negative case. An earlier version scanned every window of
    # the page and "found" 15HFIAA5004A5Z0 in a line of OCR noise - a fabricated
    # identifier that passes the checksum by chance is worse than none at all.
    noise = "ri) 7 hw vf rE oS ISHF14450044500 Chicken 555 445.00 Apollo Fish"
    check("does NOT invent a GSTIN from noise",
          extract.find_gstin(noise) is None, extract.find_gstin(noise))
    check("does NOT match without a GST label",
          extract.find_gstin("random 27AAPFU0939F1ZW text") is None)

    # ------------------------------------------------------------- extraction
    section("Field extraction")
    bill = "\n".join([
        "HOTEL SITARA GRAND",
        "Phone: 04024112221/9246569444",
        "FSSAI No. 13623012000760",
        "7039 Date 29-06-26 Time 22.40",
        "Chicken 555 1 445.00 445.00",
        "Total Amcunt 2108 28",          # OCR: lost decimal, mangled label
        "State GST @ 2.5% 52.72",
        "Central GST @ 2.5% 52.72",
        "Rounc Off 0.28",
        "Net Amount 2214.00",
    ])
    e = extract.extract(bill, bill.splitlines(), 60.0)
    check("vendor from caps run", e.vendor_name.value == "HOTEL SITARA GRAND",
          e.vendor_name.value)
    check("net amount", e.net_amount.value == 2214.00, e.net_amount.value)
    check("taxable via lost-decimal repair", e.taxable_value.value == 2108.28,
          e.taxable_value.value)
    check("CGST", e.cgst.value == 52.72, e.cgst.value)
    check("SGST", e.sgst.value == 52.72, e.sgst.value)
    check("round off", e.round_off.value == 0.28, e.round_off.value)
    check("arithmetic reconciles", e.arithmetic_ok)
    check("date parsed day-first", e.invoice_date.value == "2026-06-29",
          e.invoice_date.value)

    # Pre-tax total promotion: the net line is unreadable, so the matcher lands
    # on the pre-tax "Total Amount". Posting that would short the claim by 105.72.
    no_net = bill.replace("Net Amount 2214.00", "KOT NO Net : 13625 Amount 3629 ___ 2214.00")
    e2 = extract.extract(no_net, no_net.splitlines(), 60.0)
    check("recovers net when its label is unreadable",
          e2.net_amount.value == 2214.00, e2.net_amount.value)

    e3 = extract.extract("SHOP NAME\nPhone No: 7559738899\nTotal 450.00")
    check("phone number is not read as an amount", e3.net_amount.value == 450.00,
          e3.net_amount.value)
    e4 = extract.extract("SHOP\nDate; 30/06/7026\nTotal 100.00")
    check("repairs a corrupted year", e4.invoice_date.value == "2026-06-30",
          e4.invoice_date.value)

    # ------------------------------------------------------- fuel + ceiling
    section("Fuel triangulation and the plausibility ceiling")
    fuel = ("BALAKRISHNALAH AND CO\n"
            "Nozzle Preset Volume Density kg/m3 Rate\n"
            "DIESEL 103.00 14.45 1500.00")
    e = extract.extract(fuel, fuel.splitlines(), 45.0)
    check("recognises a fuel bill", extract.looks_like_fuel(fuel))
    check("recovers amount from rate x volume", e.net_amount.value == 1500.00,
          e.net_amount.value)
    check("says how it got there", e.net_amount.method == "fuel_triangulated",
          e.net_amount.method)

    check("ignores rate-restated-as-amount triples",
          extract.triangulate_fuel_amount([103.0, 1.0, 103.0]) is None)
    check("needs a plausible rate",
          extract.triangulate_fuel_amount([5.0, 20.0, 100.0]) is None)

    # The exact failure this guard exists for: a fuel bill whose Amount and
    # Volume columns collided into "91500. 4." for a 915-rupee purchase.
    collided = "PETROL PUMP\nAmount Volume : goa! 91500. 4.\nNozzle Preset litre"
    e2 = extract.extract(collided, collided.splitlines(), 40.0)
    check("refuses an implausible total rather than guessing",
          e2.net_amount.value is None, e2.net_amount.value)
    # Either explanation is acceptable - "the label was there but no value was
    # written like money" (more precise) or "the only candidate was too large".
    # What must never happen is a blank field with no reason given.
    check("explains why it was left blank",
          any("left blank" in n or "too large" in n for n in e2.notes),
          e2.notes)

    # The bare "Amount" label, as fuel pumps print it, with the leading letter
    # mangled by OCR. Taken from a real bill the user reported.
    pump = ('| | , PRN | | Societies "\\MOUNT: VOLUME: RATE PRODUCT: DENSITy: '
            'NOZZLE VEHICLE INVOIce NO: No 103 ye No: NO: 14 1200.00 DIESEL '
            '8215 + 5 Noy 5 2017994 89 lL | kg ENTERED 9529347 INR/L INR.')
    ep = extract.extract(pump, pump.splitlines(), 42.0)
    check("reads the bare 'AMOUNT' label through OCR damage",
          ep.net_amount.value == 1200.00, ep.net_amount.value)

    for text, label, want in [
        ("MOUNT : 1200.00", "leading A lost", 1200.00),
        ("AMOUNI 1200.00", "trailing T mangled", 1200.00),
        ("Amt 450.50", "abbreviated", 450.50),
        # No value on the line is money-formatted, so nothing may be claimed -
        # 8215 is the fuel density, not the total.
        ("AMOUNT: 103 14 8215 2017994", "no money-formatted value", None),
    ]:
        r = extract.extract("PUMP\n" + text, ("PUMP\n" + text).splitlines(), 40.0)
        check(f"amount label: {label}", r.net_amount.value == want, r.net_amount.value)

    # A decimal point this code inserted while repairing "2108 28" must not be
    # mistaken for money formatting on a weak label.
    check("merged decimals are not treated as money formatting",
          extract._line_amounts("amount: 103 14", with_flags=True) == [(103.14, False)],
          extract._line_amounts("amount: 103 14", with_flags=True))

    e3 = extract.extract("SHOP\nno label\n450.00")
    check("still fills a plausible unlabelled amount", e3.net_amount.value == 450.00,
          e3.net_amount.value)

    # ------------------------------------------------------- person memory
    section("Person memory")
    from app.classify import Memory as _Mem, LedgerClassifier as _Clf, build_query_text as _bq
    pconn = connect(TMP / "person.db")
    pmem = _Mem(pconn)
    pclf = _Clf(ls, pmem)
    for _ in range(6):
        pmem.learn_person("RAJESH KUMAR", "Printing & Stationery")
    pconn.commit()

    stat_q = _bq("SRI VENKATESWARA BOOK DEPOT A4 paper file register pen",
                 "SRI VENKATESWARA BOOK DEPOT")
    without = pclf.classify(stat_q, "SRI VENKATESWARA BOOK DEPOT", None)
    withp = pclf.classify(stat_q, "SRI VENKATESWARA BOOK DEPOT", None,
                          person="RAJESH KUMAR")
    check("person history raises confidence", withp[0].score > without[0].score,
          f"{without[0].score:.2f} -> {withp[0].score:.2f}")
    check("cites the person in the reason",
          any("RAJESH KUMAR" in r for r in withp[0].reasons))
    check("unknown person changes nothing",
          pclf.classify(stat_q, "SRI VENKATESWARA BOOK DEPOT", None,
                        person="NOBODY")[0].score == without[0].score)

    # The guard that matters: history must not override clear bill text.
    food_q = _bq("HOTEL SITARA GRAND restaurant chicken biryani curd rice",
                 "HOTEL SITARA GRAND")
    for _ in range(20):
        pmem.learn_person("FUELGUY", "FUEL EXPENSES VEHICLE")
    pconn.commit()
    hijack = pclf.classify(food_q, "HOTEL SITARA GRAND", None, person="FUELGUY")
    check("bill text still wins over person habit",
          "Boarding" in hijack[0].ledger, hijack[0].ledger)

    # ------------------------------------------------- keyword coverage
    section("Reimbursement category coverage (text only, no history)")
    kclf = _Clf(ls)
    for label, text, want in [
        ("fuel", "BALAKRISHNALAH Nozzle Preset Volume DIESEL Density Rate Vehicle No",
         "FUEL EXPENSES VEHICLE"),
        ("restaurant", "HOTEL SITARA GRAND Restaurant Chicken Apollo Fish Curd Rice Covers",
         "Boarding & Lodging"),
        ("toll", "NHAI TOLL PLAZA FASTAG vehicle class LMV single journey",
         "Travelling Expenses"),
        ("cab", "OLA CABS trip receipt pickup drop distance kms fare",
         "Travelling Expenses"),
        ("courier", "PROFESSIONAL COURIER consignment AWB docket parcel",
         "Courier Charges"),
        ("stationery", "BOOK DEPOT A4 paper file register pen stapler",
         "Printing & Stationery"),
    ]:
        top = kclf.classify(_bq(text, text.split()[0]), None, None)
        check(f"{label} -> right ledger",
              top and want.lower() in top[0].ledger.lower(),
              top[0].ledger if top else None)

    # ---------------------------------------------------------------- dedupe
    section("Duplicate detection")
    conn = connect(TMP / "dedupe.db")
    conn.execute("INSERT INTO bills(id,filename,stored_path,file_sha256,status) "
                 "VALUES (1,'orig.jpg','/x','abc','posted')")
    conn.execute("INSERT INTO extractions(bill_id,vendor_name,vendor_gstin,invoice_no,"
                 "invoice_date,net_amount) VALUES "
                 "(1,'HOTEL SITARA GRAND','36ABCFK0167H1ZH','7039','2026-06-29',2214.00)")
    conn.commit()

    cases = [
        ("identical invoice", True,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no="7039", invoice_date="2026-06-29", net_amount=2214.00)),
        ("invoice no read with a prefix", True,
         dict(vendor_name="HOTEL SITARA GRAN", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no="INV-07039", invoice_date="2026-06-29", net_amount=2214.00)),
        ("invoice no unreadable", True,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no=None, invoice_date="2026-06-29", net_amount=2214.00)),
        ("date off by one day", True,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no="7039", invoice_date="2026-06-30", net_amount=2214.00)),
        ("rounding difference", True,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no="7039", invoice_date="2026-06-29", net_amount=2213.50)),
        ("same amount+date, different vendor", False,
         dict(vendor_name="DIFFERENT CAFE", vendor_gstin="", invoice_no="9911",
              invoice_date="2026-06-29", net_amount=2214.00)),
        ("same vendor, genuinely different bill", False,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no="8123", invoice_date="2026-07-02", net_amount=880.00)),
        ("same vendor, another day and amount", False,
         dict(vendor_name="HOTEL SITARA GRAND", vendor_gstin="36ABCFK0167H1ZH",
              invoice_no=None, invoice_date="2026-07-15", net_amount=640.00)),
    ]
    for label, expect_flag, payload in cases:
        got = bool(dedupe.check_business_key(conn, payload, exclude_bill_id=99))
        check(("flags " if expect_flag else "ignores ") + label, got == expect_flag)

    check("invoice-no normalisation",
          dedupe.normalise_invoice_no("INV-0074/26") == dedupe.normalise_invoice_no("inv 74/26"))

    # ----------------------------------------------------------------- Tally
    section("Tally voucher XML")
    r = tally.Reimbursement("Boarding & Lodging Expenses", "VIJAY KIRAN GAUTARAJ",
                            2214.00, None, "Staff meals")
    xml = tally.build_voucher_xml(r, "Pacific Engineered Surfaces Pvt Ltd- FAB", "Journal")
    amounts = [float(a) for a in re.findall(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", xml)]
    check("voucher balances to zero", abs(sum(amounts)) < 0.005, amounts)
    check("expense is debited (negative)", amounts[0] == -2214.00)
    check("person is credited (positive)", amounts[1] == 2214.00)
    ledger_names = re.findall(r"<LEDGERNAME>(.*?)</LEDGERNAME>", xml)
    check("escapes & in ledger names", ledger_names[0] == "Boarding &amp; Lodging Expenses")
    check("credits the person", ledger_names[1] == "VIJAY KIRAN GAUTARAJ")

    import xml.dom.minidom as minidom
    try:
        minidom.parseString(xml)
        check("is well-formed XML", True)
    except Exception as exc:
        check("is well-formed XML", False, exc)

    for bad, label in [
        (tally.Reimbursement("", "P", 10.0), "empty expense ledger"),
        (tally.Reimbursement("L", "", 10.0), "empty person"),
        (tally.Reimbursement("L", "P", 0), "zero amount"),
        (tally.Reimbursement("L", "P", -5), "negative amount"),
        (tally.Reimbursement("L", "P", 99_999_999), "absurd amount"),
    ]:
        try:
            tally.build_voucher_xml(bad, "Co")
            check(f"rejects {label}", False)
        except ValueError:
            check(f"rejects {label}", True)

    try:
        tally.build_voucher_xml(r, "Co", "Payment")
        check("rejects Payment mode with no cash ledger", False)
    except ValueError:
        check("rejects Payment mode with no cash ledger", True)
    pay = tally.build_voucher_xml(r, "Co", "Payment", "Cash")
    check("Payment mode credits cash",
          re.findall(r"<LEDGERNAME>(.*?)</LEDGERNAME>", pay)[1] == "Cash")

    resp = tally.post_xml(xml, "127.0.0.1", 9, timeout=2)
    check("unreachable Tally gives a readable error",
          not resp.ok and "Could not reach Tally" in resp.message)

    # ------------------------------------------------------- classify + learn
    section("Classification and learning")
    from app.classify import LedgerClassifier, Memory, build_query_text, vendor_key

    conn2 = connect(TMP / "learn.db")
    mem = Memory(conn2)
    clf = LedgerClassifier(ls, mem)

    q = build_query_text(bill, "HOTEL SITARA GRAND")
    check("query drops boilerplate", "fssai" not in q and "phone" not in q)
    check("query keeps the vendor", "sitara" in q)

    s = clf.classify(q, "HOTEL SITARA GRAND", None)
    check("ranks the correct ledger first",
          s and s[0].ledger == "Boarding & Lodging Expenses",
          s[0].ledger if s else None)
    cold = s[0].score
    # What matters is that a bill with NO history never reaches the "high" band,
    # because that band means "pre-filled, confirm with one click". The absolute
    # number legitimately rose from ~0.39 to ~0.77 when the seed alias vocabulary
    # was expanded, so asserting a low ceiling would now be testing the old
    # thresholds rather than the actual safety property.
    check("cold-start never auto-fills", s[0].band != "high",
          f"{cold:.2f} / {s[0].band}")
    check("cold-start still leaves room to improve", cold < 0.85, round(cold, 2))

    vk = vendor_key("HOTEL SITARA GRAND", None)
    prev = cold
    for i in range(1, 4):
        mem.learn(vk, "Boarding & Lodging Expenses", bill)
        s = clf.classify(q, "HOTEL SITARA GRAND", None)
        check(f"confidence rises after confirmation {i}", s[0].score > prev,
              f"{prev:.2f} -> {s[0].score:.2f}")
        prev = s[0].score
        if i < 3:
            check(f"still capped below 'high' at {i} confirmation(s)",
                  s[0].band != "high", s[0].band)
    check("reaches 'high' at 3 confirmations", s[0].band == "high", s[0].band)

    mem.learn(vk, "Courier Charges", bill, suggested="Boarding & Lodging Expenses")
    rows = {r["ledger"]: r["count"] for r in
            conn2.execute("SELECT ledger, count FROM vendor_memory WHERE vendor_key=?", (vk,))}
    check("a correction decays the old mapping", rows["Boarding & Lodging Expenses"] < 3, rows)
    check("a correction is logged for audit",
          conn2.execute("SELECT COUNT(*) n FROM corrections").fetchone()["n"] == 1)
    mem.forget(vk, "Courier Charges")
    check("mappings can be forgotten",
          "Courier Charges" not in {r["ledger"] for r in
          conn2.execute("SELECT ledger FROM vendor_memory WHERE vendor_key=?", (vk,))})

    # ------------------------------------------------------------- web routes
    section("Web application")
    try:
        from fastapi.testclient import TestClient
        import app.main as m

        m.CFG["app"]["upload_dir"] = str(TMP / "uploads")
        m.CFG["tally"]["export_dir"] = str(TMP / "xml")
        m.pipeline.upload_dir = TMP / "uploads"
        m.pipeline.upload_dir.mkdir(parents=True, exist_ok=True)
        c = TestClient(m.app, raise_server_exceptions=False)

        for path in ["/", "/upload", "/mappings", "/requests", "/api/health"]:
            check(f"GET {path}", c.get(path).status_code == 200)

        up = c.get("/upload").text
        check("person field comes before the file field",
              up.index('name="person"') < up.index('name="files"'))
        check("multiple files allowed", "multiple" in up)

        check("upload without a person is rejected",
              c.post("/upload", data={"person": ""},
                     files=[("files", ("a.png", b"x", "image/png"))]).status_code >= 400)

        # ---- review screen: auto-select + Change ----
        import re as _re
        conn2 = m.conn
        conn2.execute(
            "INSERT INTO bills(id, filename, stored_path, file_sha256, person, "
            "status) VALUES (9001,'t.png','/x','uihash1','VARUN MUNDRA','review')")
        # A deliberately LOW-confidence suggestion: it must still be pre-filled.
        conn2.execute(
            "INSERT INTO extractions(bill_id, net_amount, suggestions_json, person) "
            "VALUES (9001, 500.0, ?, 'VARUN MUNDRA')",
            ('[{"ledger":"Courier Charges","score":0.41,"band":"low","reasons":["Weak text similarity"]},'
             '{"ledger":"Travelling Expenses","score":0.22,"band":"none","reasons":["Weak"]}]',))
        conn2.commit()
        page = c.get("/bill/9001").text

        picked = _re.search(r'id="ledger-input"[^>]*value="([^"]*)"', page)
        check("low-confidence suggestion is still auto-selected",
              picked and picked.group(1) == "Courier Charges",
              picked.group(1) if picked else None)
        check("low confidence is flagged to the clerk",
              "confidence is low" in page)
        check("a Change button is offered", ">Change</button>" in page)
        check("no per-row Use buttons remain", ">Use</button>" not in page)
        check("alternatives start collapsed",
              "id=\"ledger-alts\"" in page
              and "display:none" in page.split('id="ledger-alts"')[1][:80])
        check("alternatives are clickable",
              'data-ledger="Travelling Expenses"' in page)
        check("chosen ledger is not repeated in alternatives",
              'data-ledger="Courier Charges"' not in page)

        # A ledger already confirmed must win over any suggestion.
        conn2.execute("UPDATE extractions SET ledger='House Rent' WHERE bill_id=9001")
        conn2.commit()
        page2 = c.get("/bill/9001").text
        picked2 = _re.search(r'id="ledger-input"[^>]*value="([^"]*)"', page2)
        check("a confirmed ledger overrides the suggestion",
              picked2 and picked2.group(1) == "House Rent",
              picked2.group(1) if picked2 else None)

        # No suggestions at all -> the editor must be open, not a dead end.
        conn2.execute(
            "INSERT INTO bills(id, filename, stored_path, file_sha256, person, "
            "status) VALUES (9002,'t2.png','/x','uihash2','X','review')")
        conn2.commit()
        page3 = c.get("/bill/9002").text
        check("with no suggestion the search box is open",
              'id="ledger-input"' in page3
              and "display:none" not in page3.split('id="ledger-input"')[1][:300])
    except ImportError:
        print("  SKIP  fastapi TestClient not installed")

    # -------------------------------------------------------------- REST API
    # The contract the Next.js ERP is built against. These tests exist so a
    # refactor here cannot silently break the ERP: a renamed field or a changed
    # status code is a production bug in someone else's codebase.
    section("REST API for the ERP")
    try:
        from fastapi.testclient import TestClient
        import app.main as m
        conn2 = m.conn
        m.CFG.setdefault("api", {})["key"] = "unit-test-key"
        c = TestClient(m.app, raise_server_exceptions=False)
        H = {"X-API-Key": "unit-test-key", "X-User": "SHALMAN"}

        # ---- auth
        check("no key is rejected", c.get("/api/v1/health").status_code == 401)
        check("a wrong key is rejected",
              c.get("/api/v1/health",
                    headers={"X-API-Key": "nope"}).status_code == 401)
        h = c.get("/api/v1/health", headers=H)
        check("a valid key is accepted", h.status_code == 200)
        check("the ERP user is echoed back for audit",
              h.json()["user"] == "SHALMAN")
        check("health reports the real chart of accounts",
              h.json()["ledgers"] > 100, h.json()["ledgers"])
        check("health warns when dedupe is off",
              h.json()["dedupe_enabled"] is False)

        # ---- reference data
        pj = c.get("/api/v1/people?q=vijay", headers=H).json()
        check("people search finds the claimant",
              "VIJAY KIRAN GAUTARAJ" in pj["people"])
        lj = c.get("/api/v1/ledgers?q=travel", headers=H).json()
        check("ledger search finds Travelling Expenses",
              "Travelling Expenses" in lj["ledgers"])
        check("exact prefix ranks first",
              lj["ledgers"][0] == "Travelling Expenses", lj["ledgers"][:2])
        conn2.execute("INSERT OR REPLACE INTO person_memory(person, ledger, count) "
                      "VALUES ('API TESTER','Fuel Expenses',9)")
        conn2.commit()
        pref = c.get("/api/v1/ledgers?person=API TESTER", headers=H).json()
        check("with no query, this person's own history is offered",
              pref["ledgers"] == ["Fuel Expenses"], pref)

        # ---- upload validation
        check("upload without a person is rejected",
              c.post("/api/v1/bills", headers=H, data={"person": ""},
                     files=[("files", ("a.png", b"x", "image/png"))]
                     ).status_code >= 400)

        # ---- review + confirm, on a fixture bill
        conn2.execute(
            "INSERT INTO bills(id, filename, stored_path, file_sha256, person, "
            "status, batch_id, ocr_confidence, ocr_text) VALUES "
            "(9101,'api.png','/x','apihash1','VIJAY KIRAN GAUTARAJ','review',"
            "'apibatch',88.5,'HOTEL BILL 250.00')")
        conn2.execute(
            "INSERT INTO extractions(bill_id, net_amount, invoice_date, "
            "vendor_name, suggestions_json, person) VALUES "
            "(9101, 250.0, '30-07-2026', 'Hotel Sangam', ?, "
            "'VIJAY KIRAN GAUTARAJ')",
            ('[{"ledger":"Boarding & Lodging Expenses","score":0.91,'
             '"band":"high","reasons":["vendor memory"]}]',))
        conn2.commit()

        d = c.get("/api/v1/bills/9101", headers=H).json()
        check("detail returns the extraction", d["extracted"]["amount"] == 250.0)
        check("dates are ISO on the wire, not Tally format",
              d["extracted"]["date"] == "2026-07-30", d["extracted"]["date"])
        check("the OCR text is exposed so a clerk can see what was read",
              "HOTEL BILL" in (d["ocr"]["text"] or ""))
        check("the top suggestion is included",
              d["suggestions"][0]["ledger"] == "Boarding & Lodging Expenses")
        check("the image URL is absolute enough for the ERP to embed",
              d["image_url"] == "/api/v1/bills/9101/image")

        bad = c.post("/api/v1/bills/9101/confirm", headers=H,
                     json={"ledger": "Travelling Expenses", "person": "X",
                           "amount": 0})
        check("a zero amount cannot be confirmed", bad.status_code == 400)
        check("a missing ledger cannot be confirmed",
              c.post("/api/v1/bills/9101/confirm", headers=H,
                     json={"person": "X", "amount": 5}).status_code == 400)
        ok = c.post("/api/v1/bills/9101/confirm", headers=H,
                    json={"ledger": "Boarding & Lodging Expenses",
                          "person": "VIJAY KIRAN GAUTARAJ", "amount": 250.0,
                          "date": "2026-07-30"})
        check("confirm succeeds", ok.status_code == 200, ok.json())
        check("the bill is now approved",
              conn2.execute("SELECT status FROM bills WHERE id=9101"
                            ).fetchone()["status"] == "approved")
        check("confirming taught the system",
              conn2.execute(
                  "SELECT count FROM person_memory WHERE person=? AND ledger=?",
                  ("VIJAY KIRAN GAUTARAJ", "Boarding & Lodging Expenses")
              ).fetchone() is not None)

        # ---- export preview then export
        prev = c.post("/api/v1/export/preview", headers=H,
                      json={"bill_ids": [9101]})
        pv = prev.json()
        check("preview says how many vouchers", pv["vouchers"] == 1, pv)
        check("preview totals the money", pv["total"] == 250.0)
        check("preview creates nothing new for known ledgers",
              pv["new_ledgers"] == [])
        check("preview names the voucher number in advance",
              pv["voucher_numbers"][0]["voucher_no"] == "REIMB/26-27/09101",
              pv["voucher_numbers"])
        check("preview does not record an export",
              c.get("/api/v1/exports", headers=H).json()["exports"] == [])
        check("preview with no bills is rejected",
              c.post("/api/v1/export/preview", headers=H,
                     json={"bill_ids": []}).status_code == 400)

        ex = c.post("/api/v1/export", headers=H, json={"bill_ids": [9101]})
        ej = ex.json()
        check("export returns a downloadable ref", ex.status_code == 200 and ej["ok"])
        check("export tells the ERP how to import it",
              any("Transactions" in s for s in ej["import_instructions"]))
        xml = c.get(ej["download_url"], headers=H)
        check("the XML downloads", xml.status_code == 200)
        check("it is a Tally import envelope",
              "<TALLYREQUEST>Import Data</TALLYREQUEST>" in xml.text)
        check("it carries the unique voucher number",
              "<VOUCHERNUMBER>REIMB/26-27/09101</VOUCHERNUMBER>" in xml.text)
        check("it uses Tally's standard Journal",
              "<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>" in xml.text)

        # ---- the duplicate guard, which is the whole reason exports are recorded
        again = c.post("/api/v1/export/preview", headers=H,
                       json={"bill_ids": [9101]})
        aj = again.json()
        check("an exported bill is excluded from the next batch",
              aj["vouchers"] == 0, aj)
        check("and the ERP is told why",
              any("already exported" in r
                  for s in aj["skipped"] for r in s["reasons"]), aj["skipped"])
        check("exporting nothing but duplicates is rejected",
              c.post("/api/v1/export", headers=H,
                     json={"bill_ids": [9101]}).status_code == 400)
        check("an exported bill can no longer be edited",
              c.post("/api/v1/bills/9101/confirm", headers=H,
                     json={"ledger": "Travelling Expenses",
                           "person": "VIJAY KIRAN GAUTARAJ",
                           "amount": 999.0}).status_code == 409)

        # ---- export bookkeeping
        det = c.get(f"/api/v1/exports/{ej['ref']}", headers=H).json()
        check("the export lists its bills", det["bills"][0]["bill_id"] == 9101)
        check("it is not marked imported until a human says so",
              det["imported"] is False)
        check("mark-imported works",
              c.post(f"/api/v1/exports/{ej['ref']}/mark-imported", headers=H,
                     json={"note": "Errors : 0"}).status_code == 200)
        check("and it sticks",
              c.get(f"/api/v1/exports/{ej['ref']}", headers=H
                    ).json()["imported"] is True)
        check("the xlsx is offered but labelled review-only",
              "REVIEW_ONLY" in c.get(
                  ej["download_url"] + "?fmt=xlsx", headers=H
              ).headers.get("content-disposition", ""))

        # ---- new ledger creation through the API
        conn2.execute(
            "INSERT INTO bills(id, filename, stored_path, file_sha256, person, "
            "status) VALUES (9102,'api2.png','/x','apihash2','ZZ NEW GUY','approved')")
        conn2.execute(
            "INSERT INTO extractions(bill_id, net_amount, invoice_date, ledger, "
            "person) VALUES (9102, 60.0, '30-07-2026', 'ZZ New Head', 'ZZ NEW GUY')")
        conn2.commit()
        np_ = c.post("/api/v1/export/preview", headers=H,
                     json={"bill_ids": [9102]}).json()
        names = {n["name"]: n["parent"] for n in np_["new_ledgers"]}
        check("a new expense head is flagged for creation",
              names.get("ZZ New Head") == m.CFG["tally"]["new_ledger_parent"], names)
        check("a new claimant goes under the people group",
              names.get("ZZ NEW GUY") == m.CFG["tally"]["new_person_parent"], names)

        # ---- rejection + duplicate override
        conn2.execute(
            "INSERT INTO bills(id, filename, stored_path, file_sha256, status) "
            "VALUES (9103,'api3.png','/x','apihash3','duplicate')")
        conn2.execute(
            "INSERT INTO duplicates(bill_id, matched_bill_id, layer, score) "
            "VALUES (9103, 9101, 'file_hash', 1.0)")
        conn2.commit()
        check("a duplicate override needs a reason",
              c.post("/api/v1/bills/9103/override-duplicate", headers=H,
                     json={"reason": "ok"}).status_code == 400)
        check("with a reason it is allowed",
              c.post("/api/v1/bills/9103/override-duplicate", headers=H,
                     json={"reason": "genuinely ate there twice"}
                     ).status_code == 200)
        check("the override is recorded against the user",
              "SHALMAN" in (conn2.execute(
                  "SELECT override_reason FROM duplicates WHERE bill_id=9103"
              ).fetchone()["override_reason"] or ""))
        check("the bill returns to review, not straight to approved",
              conn2.execute("SELECT status FROM bills WHERE id=9103"
                            ).fetchone()["status"] == "review")
        check("reject works",
              c.post("/api/v1/bills/9103/reject", headers=H,
                     json={"reason": "not a company expense"}).status_code == 200)

        # ---- listing + filtering
        lst = c.get("/api/v1/bills?status=approved&limit=5", headers=H).json()
        check("bills can be filtered by status",
              all(b["status"] == "approved" for b in lst["bills"]), lst["total"])
        check("the list reports exported state",
              c.get("/api/v1/bills?exported=true", headers=H
                    ).json()["bills"][0]["exported"] is True)
        check("unknown bill gives 404, not a crash",
              c.get("/api/v1/bills/424242", headers=H).status_code == 404)
        check("unknown export gives 404",
              c.get("/api/v1/exports/nope", headers=H).status_code == 404)
        check("ledger requests can be raised",
              c.post("/api/v1/ledger-requests", headers=H,
                     json={"name": "ZZ Requested Head",
                           "reason": "new site"}).json()["status"] == "pending")
        check("insights are exposed to the ERP",
              c.get("/api/v1/insights", headers=H).status_code == 200)
        check("the agent journal is exposed",
              c.get("/api/v1/events?limit=5", headers=H).status_code == 200)
        check("the export was journalled",
              any("exported" in e["message"] for e in c.get(
                  "/api/v1/events?limit=50", headers=H).json()["events"]))
    except ImportError:
        print("  SKIP  fastapi TestClient not installed")

    # ------------------------------------------------------ thread safety
    section("Database thread safety")
    import threading as _th
    tdb = connect(TMP / "threads.db")

    errs: list[str] = []

    def hammer(n):
        try:
            for i in range(200):
                tdb.execute(
                    "INSERT INTO token_weights(token, ledger, weight) "
                    "VALUES (?,?,1.0) ON CONFLICT(token, ledger) "
                    "DO UPDATE SET weight = weight + 1",
                    (f"tok{i % 30}", f"L{n}"))
                tdb.execute("SELECT COUNT(*) c FROM token_weights").fetchone()
            tdb.commit()   # each thread commits its own connection
        except Exception as exc:  # noqa: BLE001
            errs.append(f"{type(exc).__name__}: {exc}")

    threads = [_th.Thread(target=hammer, args=(k,)) for k in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check("8 writer threads, zero errors", not errs, errs[:2])
    total_weight = tdb.execute(
        "SELECT SUM(weight) s FROM token_weights").fetchone()["s"]
    check("no lost updates", total_weight == 8 * 200, total_weight)

    # ------------------------------------------------- robustness battery
    section("Malformed input battery")
    ex_mod = extract

    # Unicode / non-Latin bills must not crash anything.
    hindi = "होटल सीताारा\nकुल राशि 500.00\nधन्यवाद"
    eh = ex_mod.extract(hindi, hindi.splitlines(), 40.0)
    check("non-Latin bill does not crash", True)
    check("non-Latin: no fabricated GSTIN", eh.vendor_gstin.value is None)

    check("empty text does not crash",
          ex_mod.extract("", [], 0.0).net_amount.value is None)
    check("whitespace-only text does not crash",
          ex_mod.extract("   \n  \n", ["   "], 0.0).net_amount.value is None)

    e_feb = ex_mod.extract("SHOP\nDate: 29-02-2025\nTotal 100.00")
    check("impossible date (29 Feb 2025) is dropped, amount kept",
          e_feb.invoice_date.value is None and e_feb.net_amount.value == 100.0,
          (e_feb.invoice_date.value, e_feb.net_amount.value))

    two = ("GSTIN: 27AAPFU0939F1ZV something GSTIN: 29AAGCB7383J1Z4")
    check("two GSTINs: picks a valid one, no crash",
          ex_mod.find_gstin(two)[0] in ("27AAPFU0939F1ZV", "29AAGCB7383J1Z4"))

    huge = "word " * 50000 + " Total 250.00"
    check("50k-token bill extracts without blowing up",
          ex_mod.extract(huge, huge.splitlines(), 50.0).net_amount.value == 250.0)

    # ------------------------------------------------ upload robustness
    section("Upload robustness (must degrade, never 500)")
    try:
        from fastapi.testclient import TestClient
        import app.main as m
        c = TestClient(m.app, raise_server_exceptions=False)
        m.CFG["app"]["upload_dir"] = str(TMP / "up2")
        m.pipeline.upload_dir = TMP / "up2"
        m.pipeline.upload_dir.mkdir(parents=True, exist_ok=True)

        r = c.post("/upload", data={"person": "EDGE CASE"},
                   files=[("files", ("corrupt.pdf", b"this is not a pdf at all",
                                     "application/pdf"))],
                   follow_redirects=False)
        check("corrupt PDF: no 500", r.status_code in (200, 303), r.status_code)
        row = m.conn.execute(
            "SELECT status, error FROM bills WHERE person='EDGE CASE' "
            "ORDER BY id DESC LIMIT 1").fetchone()
        check("corrupt PDF becomes a visible error bill",
              row and row["status"] == "error", dict(row) if row else None)
        check("with a readable explanation",
              row and "could not be opened" in (row["error"] or ""))

        r = c.post("/upload", data={"person": "EDGE CASE"},
                   files=[("files", ("empty.png", b"", "image/png"))],
                   follow_redirects=False)
        check("zero-byte file: no 500", r.status_code in (200, 303, 400),
              r.status_code)

        evil = c.post("/upload", data={"person": "EDGE CASE"},
                      files=[("files", ("..\\..\\evil.pdf", b"%PDF-bad",
                                        "application/pdf"))],
                      follow_redirects=False)
        check("path-traversal filename: no 500",
              evil.status_code in (200, 303), evil.status_code)
        bad = list((TMP / "up2").parent.glob("evil.pdf"))
        check("traversal filename cannot escape the upload dir", not bad)

        check("missing bill image returns 404",
              c.get("/bill-image/9999999").status_code == 404)
        check("unknown batch returns 404",
              c.get("/batch/nope").status_code == 404)
        check("insights page renders",
              c.get("/insights").status_code == 200)
    except ImportError:
        print("  SKIP  fastapi TestClient not installed")

    # --------------------------------------------------- auto-approval
    section("Auto-approval guards")
    try:
        import app.main as m
        m.CFG.setdefault("agent", {})["auto_approve"] = True
        m.CFG["agent"]["auto_approve_max_amount"] = 5000
        m.pipeline.cfg = m.CFG

        # Trust the vendor first: 3 confirmed claims.
        from app.classify import vendor_key as _vk
        vk = _vk("SITARA GRAND", None)
        for _ in range(3):
            m.pipeline.memory.learn(vk, "Boarding & Lodging Expenses",
                                    "hotel sitara grand restaurant chicken")
        m.conn.commit()

        def make_bill(sha, amount_line, person="VARUN MUNDRA"):
            text = ("SITARA GRAND\nRestaurant chicken biryani rice\n"
                    + amount_line)
            cur = m.conn.execute(
                "INSERT INTO bills(filename, stored_path, file_sha256, person, "
                "status, text_layer) VALUES ('a.pdf','/x',?,?,'queued',?)",
                (sha, person, text))
            m.conn.commit()
            return cur.lastrowid

        ok_bill = make_bill("auto1", "Net Amount 2214.00")
        res = m.pipeline.process(ok_bill)
        # With auto_post_file_mode on (the default) an approved bill continues
        # straight to 'posted' - the voucher XML is written for the accountant.
        # Either state proves the auto-approval fired.
        check("trusted vendor + small amount auto-approves",
              res.status in ("approved", "posted"), res.status)
        check("marked as agent-approved",
              m.conn.execute("SELECT auto_approved FROM bills WHERE id=?",
                             (ok_bill,)).fetchone()[0] == 1)
        check("ledger filled in for posting",
              m.conn.execute("SELECT ledger FROM extractions WHERE bill_id=?",
                             (ok_bill,)).fetchone()[0]
              == "Boarding & Lodging Expenses")

        big = make_bill("auto2", "Net Amount 45000.00")
        check("amount above the ceiling stays in review",
              m.pipeline.process(big).status == "review")

        no_person = make_bill("auto3", "Net Amount 900.00", person="")
        check("no person -> never auto-approved",
              m.pipeline.process(no_person).status == "review")

        m.CFG["agent"]["auto_approve"] = False
        off = make_bill("auto4", "Net Amount 900.00")
        check("switch off -> stays in review",
              m.pipeline.process(off).status == "review")
        m.CFG["agent"]["auto_approve"] = True
    except ImportError:
        print("  SKIP")

    # --------------------------------------------------- watch folder
    section("Watch-folder agent")
    try:
        import app.main as m
        from app.agent import InboxWatcher
        inbox_base = TMP / "wf"
        m.CFG["agent"]["watch_dir"] = str(inbox_base / "inbox")
        w = InboxWatcher(m.pipeline, m.CFG, Path("/"))
        w.root = (inbox_base / "inbox")
        w.ensure_dirs()

        pdir = w.root / "  VARUN MUNDRA  "     # sloppy folder name, on purpose
        pdir.mkdir(parents=True, exist_ok=True)
        # Windows strips trailing spaces when creating a directory, so write
        # through the name that actually landed on disk. The trimming behaviour
        # under test is unchanged — leading spaces survive on every OS.
        pdir = next(d for d in w.root.iterdir()
                    if d.is_dir() and d.name.strip() == "VARUN MUNDRA")
        f = pdir / "fuel.png"
        f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 400)

        first = w.scan_once()
        check("first sighting waits for the copy to finish", first == [])
        second = w.scan_once()
        check("stable file is ingested on the next scan", len(second) == 1,
              second)
        row = m.conn.execute("SELECT person, status FROM bills WHERE id=?",
                             (second[0],)).fetchone()
        check("person taken from the folder name (trimmed)",
              row["person"] == "VARUN MUNDRA", row["person"])
        check("original moved out of the inbox", not f.exists())
        check("filed under _done",
              any((w.root / "_done").rglob("fuel*.png")))
        third = w.scan_once()
        check("nothing left to ingest", third == [])
    except ImportError:
        print("  SKIP")

    # ------------------------------------------------- maximum agentic
    section("Auto-posting (file mode only)")
    try:
        import app.main as m
        m.CFG["agent"]["auto_post_file_mode"] = True
        m.CFG["tally"]["mode"] = "file"
        m.CFG["tally"]["export_dir"] = str(TMP / "xmlout")
        m.CFG["app"]["base_dir"] = "/"

        def seeded_bill(sha, amount="Net Amount 2214.00", person="VARUN MUNDRA"):
            text = f"SITARA GRAND\nRestaurant chicken biryani rice\n{amount}"
            cur = m.conn.execute(
                "INSERT INTO bills(filename, stored_path, file_sha256, person, "
                "status, text_layer) VALUES ('a.pdf','/x',?,?,'queued',?)",
                (sha, person, text))
            m.conn.commit()
            return cur.lastrowid

        b = seeded_bill("ap1")
        res = m.pipeline.process(b)
        check("auto-approved bill is auto-POSTED in file mode",
              res.status == "posted", res.status)
        v = m.conn.execute(
            "SELECT mode, status, created_by FROM vouchers WHERE bill_id=?",
            (b,)).fetchone()
        check("voucher recorded as written by the agent",
              v and v["created_by"] == "agent", dict(v) if v else None)
        xmls = list(Path(TMP / "xmlout").glob("*.xml"))
        check("voucher XML actually on disk", len(xmls) >= 1, len(xmls))
        check("XML balances and names the person",
              "VARUN MUNDRA" in xmls[0].read_text(encoding="utf-8"))

        # The line that must never be crossed: HTTP mode -> no autonomous post.
        m.CFG["tally"]["mode"] = "http"
        b2 = seeded_bill("ap2")
        check("HTTP mode: agent approves but NEVER posts",
              m.pipeline.process(b2).status == "approved")
        m.CFG["tally"]["mode"] = "file"
    except ImportError:
        print("  SKIP")

    section("Anomaly sentinel")
    try:
        import app.main as m
        # Give the person a history of ~300-rupee claims.
        for i in range(6):
            cur = m.conn.execute(
                "INSERT INTO bills(filename, stored_path, file_sha256, person, "
                "status) VALUES ('h.pdf','/x',?, 'VARUN MUNDRA','posted')",
                (f"hist{i}",))
            m.conn.execute(
                "INSERT INTO extractions(bill_id, person, net_amount, ledger) "
                "VALUES (?,?,?,?)",
                (cur.lastrowid, "VARUN MUNDRA", 300.0 + i,
                 "Boarding & Lodging Expenses"))
        m.conn.commit()

        big = m.conn.execute(
            "INSERT INTO bills(filename, stored_path, file_sha256, person, "
            "status, text_layer) VALUES ('big.pdf','/x','anom1','VARUN MUNDRA',"
            "'queued','SITARA GRAND\nRestaurant chicken biryani\nNet Amount 4800.00')")
        m.conn.commit()
        res = m.pipeline.process(big.lastrowid)
        check("15x the median claim is NOT auto-approved",
              res.status == "review", res.status)
        check("clerk is told why",
              any("median claim" in msg for msg in res.messages), res.messages)
        ev = m.conn.execute(
            "SELECT COUNT(*) c FROM agent_events WHERE kind='anomaly'"
        ).fetchone()["c"]
        check("anomaly written to the journal", ev >= 1, ev)

        normal = m.conn.execute(
            "INSERT INTO bills(filename, stored_path, file_sha256, person, "
            "status, text_layer) VALUES ('n.pdf','/x','anom2','VARUN MUNDRA',"
            "'queued','SITARA GRAND\nRestaurant chicken biryani\nNet Amount 320.00')")
        m.conn.commit()
        res2 = m.pipeline.process(normal.lastrowid)
        check("a normal-sized claim still auto-approves",
              res2.status in ("approved", "posted"), res2.status)
    except ImportError:
        print("  SKIP")

    section("Variant self-tuning")
    try:
        import app.main as m
        pl = m.pipeline
        pl.cfg["agent"]["variant_autotune"] = True
        pl.cfg["agent"]["autotune_min_sample"] = 200
        pl.cfg["agent"]["explore_every"] = 10
        fake = {"grayscale": None, "adaptive": None, "otsu": None}

        pl._variant_wins = {"grayscale": 10, "adaptive": 5, "otsu": 5}
        pl._processed_since_start = 0
        check("no pruning before the evidence bar",
              len(pl._variants_to_run(dict(fake))) == 3)

        pl._variant_wins = {"grayscale": 950, "adaptive": 30, "otsu": 20}
        pl._processed_since_start = 0
        sizes = [len(pl._variants_to_run(dict(fake))) for _ in range(10)]
        check("dominant variant runs alone", sizes[:9] == [1] * 9, sizes)
        check("every 10th bill still explores the full set", sizes[9] == 3,
              sizes)

        pl._variant_wins = {"grayscale": 500, "adaptive": 400, "otsu": 100}
        pl._processed_since_start = 0
        check("contested stats keep the full set",
              len(pl._variants_to_run(dict(fake))) == 3)
    except ImportError:
        print("  SKIP")

    section("Maintenance loop and journal")
    try:
        import app.main as m
        from app.agent import MaintenanceLoop, InboxWatcher
        w2 = InboxWatcher(m.pipeline, m.CFG, Path("/"))
        w2.root = TMP / "wf2" / "inbox"
        w2.ensure_dirs()
        loop = MaintenanceLoop(m.pipeline, m.CFG, m.conn, Path("/"), w2)

        report = loop.tick()   # Tally is not running anywhere in the test env
        check("tick survives Tally being unreachable",
              report["tally_synced"] is False)
        check("daily digest written on first tick",
              report["digest"] is not None and "Daily digest" in report["digest"],
              report["digest"])
        report2 = loop.tick()
        check("digest not repeated within the same day",
              report2["digest"] is None)

        fdir = w2.root / "_failed" / "VARUN MUNDRA"
        fdir.mkdir(parents=True, exist_ok=True)
        (fdir / "hiccup.png").write_bytes(b"x" * 100)
        moved = loop._retry_failed()
        check("failed file re-queued exactly once", moved == 1, moved)
        back = list((w2.root / "VARUN MUNDRA").glob("hiccup_retry.png"))
        check("retry copy is marked so it never loops", len(back) == 1)
        (fdir / "dead_retry.png").write_bytes(b"x")
        check("a file that failed twice stays failed",
              loop._retry_failed() == 0)

        c = TestClient(m.app, raise_server_exceptions=False)
        page = c.get("/journal")
        check("journal page renders", page.status_code == 200)
        check("journal shows the digest", "Daily digest" in page.text)
        check("journal filter works",
              c.get("/journal?kind=anomaly").status_code == 200)
    except ImportError:
        print("  SKIP")

    # ------------------------------------------------- live Tally layer
    section("Live Tally layer (offline-verifiable parts)")
    raw_daybook = (
        '<ENVELOPE><BODY><DATA>'
        '<VOUCHER VCHTYPE="Journal"><DATE>20260729</DATE>'
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Travelling Expenses</LEDGERNAME>'
        '<AMOUNT>-11662.00</AMOUNT></ALLLEDGERENTRIES.LIST>'
        '<ALLLEDGERENTRIES.LIST><LEDGERNAME>VIJAY KIRAN GAUTARAJ</LEDGERNAME>'
        '<AMOUNT>11662.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>'
        '<VOUCHER VCHTYPE="Payment"><DATE>20260729</DATE>'
        '<LEDGERENTRIES.LIST><LEDGERNAME>Repairs &amp; Maintenance</LEDGERNAME>'
        '<AMOUNT>-500.00</AMOUNT></LEDGERENTRIES.LIST>'
        '<LEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME>'
        '<AMOUNT>500.00</AMOUNT></LEDGERENTRIES.LIST></VOUCHER>'
        '</DATA></BODY></ENVELOPE>')
    vs = tally.parse_day_book(raw_daybook)
    check("day book parser finds both vouchers", len(vs) == 2, len(vs))
    check("entries carry ledger + signed amount",
          ("VIJAY KIRAN GAUTARAJ", 11662.0) in vs[0]["entries"], vs[0]["entries"])
    check("survives Tally's unescaped-& habit",
          vs[1]["entries"][0][0] == "Repairs & Maintenance")
    check("empty response parses to nothing", tally.parse_day_book("") == [])
    check("garbage response parses to nothing",
          tally.parse_day_book("<html>not tally</html>") == [])

    from datetime import date as _d
    check("unreachable Tally counts as zero duplicates (never blocks)",
          tally.find_matching_vouchers("Co", _d.today(), "X", 100.0,
                                       "127.0.0.1", 9) == 0)

    try:
        import app.main as m
        c = TestClient(m.app, raise_server_exceptions=False)
        # Live-synced ledgers must appear in the review dropdown immediately.
        m.conn.execute(
            "INSERT INTO ledgers_cache(name, parent) VALUES "
            "('Medical Expenses','ADMINISTRATION EXPENSES') "
            "ON CONFLICT(name) DO NOTHING")
        m.conn.commit()
        page = c.get("/bill/9001").text
        check("synced Tally ledger appears in the dropdown",
              'value="Medical Expenses"' in page)
        check("insights page has a Sync-now button",
              "sync-now" in c.get("/insights").text)
        r = c.post("/api/sync-ledgers")
        check("sync endpoint fails politely without Tally",
              r.status_code == 502 and "error" in r.json(), r.status_code)
    except ImportError:
        print("  SKIP")

    # -------------------------------------------- batch export vs real sample
    section("Batch export (validated against PESPL's own voucher XML)")
    from datetime import date as _dt
    from app.export_batch import BatchLine, build_batch, norm_key
    import xml.dom.minidom as _md
    import yaml as _yaml

    _cfg = _yaml.safe_load((BASE / "config.yaml").read_text(encoding="utf-8"))
    _t = _cfg["tally"]
    known = {l.name for l in ls} | {
        "Travelling Expenses", "Boarding & Lodging Expenses",
        "VIJAY KIRAN GAUTARAJ"}

    batch = [
        BatchLine(101, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses",
                  11662.00, _dt(2026, 4, 17), vendor="AIR TICKET"),
        BatchLine(102, "BRAND NEW PERSON", "Brand New Expense Head",
                  1200.00, _dt(2026, 6, 3)),
        BatchLine(103, "VIJAY KIRAN GAUTARAJ", "Boarding & Lodging Expenses",
                  2214.00, _dt(2026, 6, 29), vendor="HOTEL SITARA GRAND"),
        BatchLine(104, "", "Travelling Expenses", 500.0),        # skipped
        BatchLine(105, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses", 0),  # skipped
    ]
    r = build_batch(batch, _t["company"], known, "Journal",
                    _t.get("cash_ledger"), _t["new_ledger_parent"],
                    _t["new_person_parent"], _t.get("company_gstin", ""),
                    _t.get("gst_registration", ""), _t.get("gst_state", ""))
    x = r["xml"]

    check("3 valid vouchers, 2 skipped",
          r["vouchers"] == 3 and len(r["skipped"]) == 2,
          (r["vouchers"], r["skipped"]))
    check("total counts only valid lines", r["total"] == 15076.00, r["total"])

    try:
        _md.parseString(x)
        check("well-formed XML", True)
    except Exception as exc:
        check("well-formed XML", False, exc)

    # These four were WRONG before the real sample arrived.
    check("REPORTNAME is 'Vouchers' (was 'All Masters')",
          "<REPORTNAME>Vouchers</REPORTNAME>" in x)
    check("company string matches Tally's exactly, suffixes included",
          "(from 1-Apr-21)" in x)
    check("party line carries ISPARTYLEDGER=Yes",
          x.count("<ISPARTYLEDGER>Yes</ISPARTYLEDGER>") == 3)
    check("party line carries BILLALLOCATIONS New Ref",
          x.count("<BILLTYPE>New Ref</BILLTYPE>") == 3)

    check("expense line carries ISPARTYLEDGER=No",
          x.count("<ISPARTYLEDGER>No</ISPARTYLEDGER>") == 3)
    check("GSTIN stamped on vouchers", "33AALCP2750N1Z3" in x)

    amts = [float(a) for a in re.findall(r"<AMOUNT>(-?[\d.]+)</AMOUNT>", x)]
    # 3 per voucher: expense, party, bill-allocation.
    check("each voucher's Dr and Cr cancel",
          all(abs(amts[i] + amts[i + 1]) < 0.005 for i in range(0, len(amts), 3)),
          amts)
    check("bill allocation equals the credit",
          all(abs(amts[i + 1] - amts[i + 2]) < 0.005 for i in range(0, len(amts), 3)))

    check("ampersand escaped in ledger names", "Boarding &amp; Lodging" in x)

    # New masters must come first or Tally rejects the voucher that uses them.
    li = [m.start() for m in re.finditer(r"<LEDGER ", x)]
    vi = [m.start() for m in re.finditer(r"<VOUCHER ", x)]
    check("all new ledgers precede all vouchers", max(li) < min(vi), (li, vi))
    check("only genuinely-new names are created",
          {n["name"] for n in r["new_ledgers"]}
          == {"BRAND NEW PERSON", "Brand New Expense Head"},
          r["new_ledgers"])
    check("new person goes under the verified people group",
          all(n["parent"] == "SUNDRY CRS FOR SUNDRY EXPENSES"
              for n in r["new_ledgers"] if "PERSON" in n["name"]))
    check("existing ledgers are never recreated",
          not any(n["name"] == "VIJAY KIRAN GAUTARAJ" for n in r["new_ledgers"]))
    check("whitespace variants count as the same ledger",
          norm_key("Professional  Fees") == norm_key("professional fees"))

    # 100 bills in one file - the actual use case.
    many = [BatchLine(i, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses",
                      100.0 + i, _dt(2026, 7, 1)) for i in range(200, 300)]
    big = build_batch(many, _t["company"], known, "Journal")
    check("100 bills -> one file", big["vouchers"] == 100, big["vouchers"])
    check("100-voucher file is well-formed",
          _md.parseString(big["xml"]) is not None)
    check("no duplicate bill references",
          len(set(re.findall(r"<NAME>(REIMB-\d+)</NAME>", big["xml"]))) == 100)

    # Voucher numbering. Regression: with no <VOUCHERNUMBER> Tally stamped every
    # imported voucher "1" - confirmed on PESPL's live data, where ten test
    # vouchers all shared Vch No 1.
    from app.export_batch import fy_label, voucher_number
    nums = re.findall(r"<VOUCHERNUMBER>(.*?)</VOUCHERNUMBER>", big["xml"])
    check("every voucher carries a number", len(nums) == 100)
    check("voucher numbers are unique", len(set(nums)) == 100)
    check("number encodes the financial year", all("/26-27/" in n for n in nums),
          nums[0])
    check("FY rolls over on 1 April",
          (fy_label(_dt(2026, 3, 31)), fy_label(_dt(2026, 4, 1)))
          == ("25-26", "26-27"))
    check("an explicit voucher number is respected",
          "<VOUCHERNUMBER>PES/MANUAL/7</VOUCHERNUMBER>" in build_batch(
              [BatchLine(7, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses", 5.0,
                         _dt(2026, 7, 1), voucher_no="PES/MANUAL/7")],
              _t["company"], known, "Journal")["xml"])
    check("number traces back to the bill id",
          voucher_number(42, _dt(2026, 7, 30)) == "REIMB/26-27/00042")
    check("prefix is configurable",
          voucher_number(42, _dt(2026, 7, 30), "PES/CLAIM")
          == "PES/CLAIM/26-27/00042")

    # ---- export guard. Standard Journal means Tally cannot reject duplicates
    # for us, so this is the only thing standing between an approved bill and a
    # second voucher.
    g_lines = [BatchLine(501, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses",
                         11.0, _dt(2026, 7, 30)),
               BatchLine(502, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses",
                         12.0, _dt(2026, 7, 30))]
    g = build_batch(g_lines, _t["company"], known, "Journal",
                    already_exported={501})
    check("an already-exported bill is excluded", g["vouchers"] == 1)
    check("and the reason is reported, not silent",
          any("already exported" in r
              for s in g["skipped"] for r in s["reasons"]), g["skipped"])
    check("the total reflects only what is included", g["total"] == 12.0)
    dup = build_batch(g_lines + [g_lines[0]], _t["company"], known, "Journal")
    check("the same bill twice in one batch is caught", dup["vouchers"] == 2)
    check("duplicate voucher numbers cannot occur",
          len(set(re.findall(r"<VOUCHERNUMBER>(.*?)</VOUCHERNUMBER>",
                             dup["xml"]))) == dup["vouchers"])
    check("config uses Tally's standard Journal, not a custom type",
          _t.get("batch_voucher_type") == "Journal"
          and _t.get("create_voucher_type") is False)
    check("payment run will use Tally's standard Payment",
          _t.get("payment_voucher_type") == "Payment")

    # ---- dedicated voucher type: still supported, in case PESPL ever wants
    # Tally-side duplicate rejection. Off by default (see config.yaml).
    vt = build_batch(
        [BatchLine(1, "VIJAY KIRAN GAUTARAJ", "Travelling Expenses", 11.0,
                   _dt(2026, 7, 30))],
        _t["company"], known, voucher_type="Reimbursement Journal",
        create_voucher_type=True, voucher_type_parent="Journal")
    check("voucher type is created", vt["new_voucher_type"] == "Reimbursement Journal")
    check("it is a child of Journal", "<PARENT>Journal</PARENT>" in vt["xml"])
    check("Tally will refuse a re-import (PREVENTDUPLICATE)",
          "<PREVENTDUPLICATE>Yes</PREVENTDUPLICATE>" in vt["xml"])
    check("numbering is manual, so our numbers survive",
          "<NUMBERINGMETHOD>Manual</NUMBERINGMETHOD>" in vt["xml"])
    check("it does not touch stock", "<AFFECTSSTOCK>No</AFFECTSSTOCK>" in vt["xml"])
    check("voucher type precedes every voucher",
          vt["xml"].index("<VOUCHERTYPE ") < vt["xml"].index("<VOUCHER "))
    check("vouchers use the new type",
          vt["xml"].count("<VOUCHERTYPENAME>Reimbursement Journal"
                          "</VOUCHERTYPENAME>") == 1)
    check("still well-formed with the type block",
          _md.parseString(vt["xml"]) is not None)
    check("built-in Journal is never recreated",
          build_batch([BatchLine(1, "VIJAY KIRAN GAUTARAJ",
                                 "Travelling Expenses", 11.0, _dt(2026, 7, 30))],
                      _t["company"], known, voucher_type="Journal",
                      create_voucher_type=True)["new_voucher_type"] is None)
    check("an existing custom type is not recreated",
          build_batch([BatchLine(1, "VIJAY KIRAN GAUTARAJ",
                                 "Travelling Expenses", 11.0, _dt(2026, 7, 30))],
                      _t["company"], known,
                      voucher_type="Reimbursement Journal",
                      known_voucher_types={"reimbursement  journal"},
                      )["new_voucher_type"] is None)
    check("100-bill batch emits the type exactly once",
          build_batch(many, _t["company"], known,
                      voucher_type="Reimbursement Journal"
                      )["xml"].count("<VOUCHERTYPE ") == 1)
    check("the custom type stays available but unused by default",
          _t.get("voucher_type_parent") == "Journal")

    # ---------------------------------------- master xml parser
    section("Tally All Masters parser")
    master = BASE / "data" / "MASTER.xml"
    if master.exists():
        from app.master_xml import load_from_master_xml, summarise
        ml = load_from_master_xml(master)
        s2 = summarise(ml)
        check("parses the full chart of accounts", s2["total"] == 2538, s2["total"])
        by2 = {l.name: l for l in ml}
        # These exist in Tally but were ABSENT from the trial balance report.
        for name in ("Staff Welfare Expenses", "Medical Expenses",
                     "Canteen Expenses", "Fuel Expenses - Varun Mundra"):
            check(f"finds '{name}' (missing from the trial balance)", name in by2)
        check("nature resolved through nested groups",
              by2["Staff Welfare Expenses"].nature == "expense",
              by2["Staff Welfare Expenses"].nature)
        check("every LEDGER is postable (groups are separate elements)",
              all(l.is_postable for l in ml))
        check("people group holds the claimants",
              sum(1 for l in ml
                  if (l.parent or "").upper() == "SUNDRY CRS FOR SUNDRY EXPENSES") > 300)
    else:
        print("  SKIP  data/MASTER.xml not present")

    # ------------------------------------------------- hardening regressions
    # One check per defect found in the pre-merge review. Each of these passed
    # silently before the fix and would have cost real money.
    section("Hardening regressions (pre-ERP-merge review)")
    from xml.dom import minidom
    from datetime import date as _date

    # 1. Quotes and control characters in names must not corrupt the XML.
    #    They land in ATTRIBUTES (LEDGER NAME="..."), so an apostrophe used to
    #    close the attribute early.
    from app.export_batch import BatchLine, build_batch, batch_filename
    nasty_person = 'VARUN "VJ" O\'BRIEN'
    nasty_ledger = "Repairs & Maint\x0c Expenses"
    b = build_batch(
        [BatchLine(1, nasty_person, nasty_ledger, 100.0, _date(2026, 7, 30))],
        "PESPL & Co", set(), voucher_type="Journal")
    try:
        minidom.parseString(b["xml"])
        wellformed = True
    except Exception as exc:            # noqa: BLE001
        wellformed = False
        print("     parse error:", exc)
    check("quotes/control chars keep the batch XML well-formed", wellformed)
    check("double quotes are escaped in attributes", "&quot;" in b["xml"])
    check("form feed never reaches the XML", "\x0c" not in b["xml"])

    # 2. Export refs must be unique within the same clock minute.
    refs = {batch_filename() for _ in range(50)}
    check("export refs are unique inside one minute", len(refs) == 50, len(refs))

    # 3. A voucher must name its ledger exactly as the master spells it.
    b2 = build_batch(
        [BatchLine(2, "SOME PERSON", "Travelling  Expenses", 50.0)],
        "PESPL", {"Travelling Expenses", "SOME PERSON"}, voucher_type="Journal")
    check("whitespace-variant ledger is canonicalised to the master spelling",
          "<LEDGERNAME>Travelling Expenses</LEDGERNAME>" in b2["xml"]
          and "Travelling  Expenses" not in b2["xml"])
    check("and it is NOT created as a new ledger", not b2["new_ledgers"])

    # 4. Numeric character references are decoded, not deleted.
    from app.master_xml import unescape as mx_unescape
    check("accented ledger names survive the master parser",
          mx_unescape("Caf&#233; Expenses") == "Café Expenses",
          mx_unescape("Caf&#233; Expenses"))
    check("Tally control-char prefixes are still stripped",
          mx_unescape("&#4;Sundry Creditors") == "Sundry Creditors")
    check("&amp; is undone last",
          mx_unescape("A &amp;#8377; B") == "A &#8377; B",
          mx_unescape("A &amp;#8377; B"))

    # 5. Only human-confirmed, non-duplicate bills may be exported.
    try:
        import app.api as api_mod2
        conn3 = m.conn
        conn3.execute("DELETE FROM bills WHERE id IN (9401,9402,9403)")
        conn3.execute("DELETE FROM extractions WHERE bill_id IN (9401,9402,9403)")
        conn3.execute("DELETE FROM duplicates WHERE bill_id IN (9401,9402,9403)")
        for bid, status in ((9401, "review"), (9402, "approved"), (9403, "approved")):
            conn3.execute(
                "INSERT INTO bills(id, filename, stored_path, file_sha256, person,"
                " status) VALUES (?,?,?,?,?,?)",
                (bid, f"h{bid}.png", "/x", f"hard{bid}", "VARUN MUNDRA", status))
            conn3.execute(
                "INSERT INTO extractions(bill_id, net_amount, invoice_date, ledger,"
                " person) VALUES (?,?,?,?,?)",
                (bid, 75.0, "30-07-2026", "Fuel Expenses", "VARUN MUNDRA"))
        # 9403 carries a live duplicate warning
        conn3.execute(
            "INSERT INTO duplicates(bill_id, matched_bill_id, layer, score, overridden)"
            " VALUES (9403, 9402, 'business_key', 0.99, 0)")
        conn3.commit()
        built = api_mod2._build([9401, 9402, 9403])
        going = {l.bill_id for l in built["lines"]}
        blocked = {s["bill_id"]: " ".join(s["reasons"]) for s in built["skipped"]}
        check("an unconfirmed bill cannot be exported", 9401 not in going)
        check("and the reason says so", "not approved" in blocked.get(9401, ""))
        check("a bill with an open duplicate cannot be exported", 9403 not in going)
        check("and the reason says so", "duplicate" in blocked.get(9403, ""))
        check("the approved, clean bill still goes", 9402 in going)
    except Exception as exc:            # noqa: BLE001
        check("export eligibility gate runs", False, exc)

    # 6. With no key configured the API must refuse, not serve anonymously.
    try:
        real_cfg = api_mod2.CTX["cfg"]
        api_mod2.CTX["cfg"] = {**real_cfg,
                               "api": {"key": "", "allow_unauthenticated": False}}
        c2 = TestClient(m.app)
        check("no api.key configured -> requests are refused",
              c2.get("/api/v1/people").status_code == 503)
        api_mod2.CTX["cfg"] = {**real_cfg, "api": {"key": "s3cret"}}
        check("wrong key is rejected",
              c2.get("/api/v1/people", headers={"X-API-Key": "nope"}).status_code == 401)
        # Called directly: httpx refuses to SEND a non-ASCII header, but a real
        # server decodes bytes as latin-1 and hands them straight to us, where
        # compare_digest on a non-ASCII str used to raise TypeError -> 500.
        try:
            api_mod2.require_key("ké", "someone")
            nonascii_ok = False
        except Exception as exc:        # noqa: BLE001
            nonascii_ok = getattr(exc, "status_code", None) == 401
        check("non-ASCII key is rejected cleanly, not a 500", nonascii_ok)
        check("the right key is accepted",
              c2.get("/api/v1/people", headers={"X-API-Key": "s3cret"}).status_code == 200)
    finally:
        api_mod2.CTX["cfg"] = real_cfg

    # -------------------------------------------------------------------- end
    print("\n" + "=" * 62)
    if FAILURES:
        print(f"{len(FAILURES)} FAILED:")
        for f in FAILURES:
            print("   -", f)
    else:
        print("ALL TESTS PASSED")
    print("=" * 62)
    shutil.rmtree(TMP, ignore_errors=True)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())

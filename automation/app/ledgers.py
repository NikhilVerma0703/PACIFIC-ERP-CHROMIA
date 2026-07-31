"""
Ledger master.

Two sources, same output shape:
  1. Tally XML gateway (authoritative, use in production - see tally.py)
  2. Trial Balance .xlsx export (bootstrap, used for the pilot)

The trial balance encodes Tally's group tree as Excel indent levels. Those
indents are NOT clean in a real Tally export - they jump 0 -> 2 -> 4 -> 3 -> 5
rather than nesting by one. So indent is treated as a *relative* signal: pop
the parent stack until we find a strictly smaller indent. That reconstructs
the tree correctly despite the noise.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Root groups in a standard Tally chart of accounts, mapped to the "nature"
# we use to filter candidate ledgers. A food bill must never be able to match
# an equity ledger; this filter removes ~60% of the search space for free.
ROOT_NATURE = {
    "capital account": "equity",
    "loans (liability)": "liability",
    "current liabilities": "liability",
    "fixed assets": "asset",
    "current assets": "asset",
    "investments": "asset",
    "misc. expenses (asset)": "asset",
    "branch / divisions": "other",
    "suspense a/c": "other",
    "sales accounts": "income",
    "income (direct)": "income",
    "income (indirect)": "income",
    "purchase accounts": "expense",
    "expenses (direct)": "expense",
    "expenses (indirect)": "expense",
    "unadjusted forex gain/loss": "other",
}

# Ledgers a purchase voucher may legitimately debit.
PURCHASE_DEBIT_NATURES = {"expense", "asset"}

STOPWORDS = {
    "a/c", "ac", "account", "accounts", "and", "the", "of", "for", "to",
    "&", "-", "expenses", "expense", "charges", "charge",
}


@dataclass
class Ledger:
    name: str
    parent: str | None
    root_group: str
    path: list[str]
    nature: str
    is_postable: bool
    indent: int
    debit: float | None = None
    credit: float | None = None
    aliases: list[str] = field(default_factory=list)

    @property
    def search_text(self) -> str:
        """Name plus ancestry plus aliases - what the matchers actually score against.

        Including ancestry matters: the ledger 'Insurance' is ambiguous alone,
        but 'Insurance ADMINISTRATION EXPENSES Expenses (Indirect)' is not.
        """
        parts = [self.name] + self.path[:-1] + self.aliases
        return normalise(" ".join(parts))

    def to_dict(self) -> dict:
        d = asdict(self)
        d["search_text"] = self.search_text
        return d


def normalise(text: str) -> str:
    """Lowercase, strip punctuation and Excel artefacts, collapse whitespace."""
    if not text:
        return ""
    text = text.replace("_x000D_", " ").replace("\r", " ").replace("\n", " ")
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s/&.-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def tokenise(text: str) -> list[str]:
    """Meaningful tokens only - drops stopwords and pure numbers."""
    toks = normalise(text).split()
    return [t for t in toks if t not in STOPWORDS and len(t) > 2 and not t.isdigit()]


def _root_nature(root_group: str) -> str:
    key = normalise(root_group)
    for prefix, nature in ROOT_NATURE.items():
        if key.startswith(normalise(prefix)):
            return nature
    return "other"


def load_from_trial_balance(xlsx_path: str | Path, sheet: str | None = None) -> list[Ledger]:
    """Parse a Tally Trial Balance export into a ledger list."""
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]

    # Find the header row ("Particulars") - rows above it are company letterhead.
    start = 1
    for r in range(1, min(40, ws.max_row + 1)):
        if normalise(str(ws.cell(r, 1).value or "")) == "particulars":
            start = r + 1
            break

    raw: list[tuple[int, str, float | None, float | None]] = []
    for r in range(start, ws.max_row + 1):
        cell = ws.cell(r, 1)
        name = str(cell.value or "").replace("_x000D_", "").strip()
        if not name:
            continue
        if normalise(name) in {"grand total", "debit", "credit", "closing balance", "opening balance"}:
            continue
        indent = int(cell.alignment.indent or 0)
        debit = _num(ws.cell(r, 2).value)
        credit = _num(ws.cell(r, 3).value)
        raw.append((indent, name, debit, credit))

    # Rebuild the tree. Stack holds (indent, name); pop until strictly smaller.
    ledgers: list[Ledger] = []
    stack: list[tuple[int, str]] = []
    for indent, name, debit, credit in raw:
        while stack and stack[-1][0] >= indent:
            stack.pop()
        path = [s[1] for s in stack] + [name]
        parent = stack[-1][1] if stack else None
        root = path[0]
        ledgers.append(
            Ledger(
                name=name,
                parent=parent,
                root_group=root,
                path=path,
                nature=_root_nature(root),
                is_postable=True,  # corrected below
                indent=indent,
                debit=debit,
                credit=credit,
            )
        )
        stack.append((indent, name))

    # A row with children is a group header. Tally rejects vouchers posted to
    # a group, so those are marked non-postable.
    parents = {l.parent for l in ledgers if l.parent}
    for l in ledgers:
        if l.name in parents or l.indent == 0:
            l.is_postable = False

    _attach_aliases(ledgers)
    return ledgers


def _num(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Seed aliases
#
# Cold-start is the weak point of any learning system. Without these, the first
# few hundred bills all land in the review queue and the team loses faith in
# the tool before the learning loop has anything to learn from.
#
# Keys are matched against ledger names case-insensitively (substring).
# ---------------------------------------------------------------------------
SEED_ALIASES: dict[str, list[str]] = {
    # Reimbursements are dominated by food, fuel and travel, so those three get
    # the most vocabulary. Every word here was chosen because it appears on the
    # bill itself - dish names, pump terminology, ride-hailing brands - rather
    # than because it describes the accounting category. The bill says
    # "Chicken Biryani", never "Boarding & Lodging".
    "boarding & lodging": ["oyo", "treebo", "fabhotel", "zostel", "taj", "itc",
                           "marriott", "lemon tree", "ginger", "check in",
                           "check out", "room no", "room rent", "room service",
                           "tariff per day", "nights", "swiggy", "zomato",
                           "hotel", "restaurant", "food", "meal", "lunch", "dinner",
                           "breakfast", "catering", "stay", "accommodation",
                           "guest house", "lodge", "tiffin", "canteen", "mess",
                           "dhaba", "cafe", "cafeteria", "bakery", "sweets",
                           "snacks", "beverage", "juice", "tea", "coffee",
                           "biryani", "kebab", "curry", "rice", "roti", "naan",
                           "paneer", "chicken", "mutton", "fish", "veg", "thali",
                           "dosa", "idli", "vada", "samosa", "pizza", "burger",
                           "sandwich", "noodles", "soup", "dessert", "ice cream",
                           "water bottle", "mineral water", "drinking water",
                           "table no", "covers", "kot", "waiter", "dine",
                           "sitara", "grand", "residency", "darbar", "bhavan",
                           "udupi", "sagar", "biryani house", "family restaurant"],
    # Key is "fuel expenses", NOT "fuel expenses vehicle". PESPL tracks fuel
    # per claimant and per vehicle - "Fuel Expenses - Varun Mundra",
    # "Fuel Expenses - Vehicle Bolero TN70 AP3179" - and a narrower key gave
    # those ledgers no fuel vocabulary at all, so a fuel bill could never match
    # the ledger it actually belongs to.
    "fuel expenses": ["petrol", "diesel", "fuel", "hsd", "ms petrol",
                              "bharat petroleum", "indian oil", "iocl", "bpcl",
                              "hpcl", "hindustan petroleum", "shell", "nayara",
                              "reliance petroleum", "essar", "jio-bp", "iol",
                              "petrol pump", "filling station", "fuel station",
                              "service station", "petroleum", "oil corporation",
                              # Pump printout vocabulary - these words appear on
                              # almost every Indian fuel receipt and nowhere else.
                              "nozzle", "preset", "density", "kg/m3", "litre",
                              "ltrs", "volume", "vehicle no", "odometer",
                              "fip", "pump no", "attendant", "fuel type"],
    "fuel expenses - dg set": ["dg diesel", "generator fuel", "genset diesel"],
    # Heavily used at PESPL (521 journal lines) but absent from the collapsed
    # trial balance. Staff refreshments and canteen bills belong here rather
    # than in Boarding & Lodging.
    "staff welfare": ["staff welfare", "refreshment", "refreshments", "snacks",
                      "tea", "coffee", "biscuit", "britannia", "parle",
                      "water can", "bisleri", "kinley", "aquafina", "canteen",
                      "food", "lunch", "dinner", "meal", "hotel", "restaurant",
                      "sweets", "juice", "milk", "curd", "buttermilk", "fruits",
                      "swiggy", "zomato", "grocery", "dmart", "d-mart",
                      "reliance fresh", "more supermarket", "birthday", "cake",
                      "welfare", "celebration"],
    "canteen": ["canteen", "mess", "food", "meal", "lunch", "tiffin", "kitchen",
                "cook", "groceries", "vegetables", "provisions"],
    "medical expenses": ["medical", "hospital", "clinic", "pharmacy", "medicine",
                         "doctor", "consultation", "lab test", "diagnostic",
                         "apollo", "medplus", "netmeds", "pharmeasy", "1mg",
                         "chemist", "druggist", "tablets", "tablet", "capsule",
                         "syrup", "injection", "first aid", "bandage", "ointment",
                         "scan", "x-ray", "xray", "blood test", "opd", "rx"],
    "courier charges": ["courier", "dtdc", "bluedart", "blue dart", "fedex",
                        "dhl", "aramex", "gati", "professional courier",
                        "speed post", "india post", "registered post", "parcel",
                        "consignment", "awb", "docket", "delhivery", "ekart",
                        "shiprocket", "tracking no", "pod"],
    "printing & stationery": ["stationery", "printing", "xerox", "photocopy",
                              "paper", "a4", "cartridge", "toner", "ink", "pen",
                              "pencil", "marker", "register", "notebook", "file",
                              "folder", "envelope", "stapler", "tape", "glue",
                              "book depot", "book stall", "press", "letterhead",
                              "visiting card", "id card", "lamination", "binding",
                              "rubber stamp", "seal"],
    "telephone expenses": ["telephone", "mobile", "airtel", "jio", "vodafone",
                           "vi ", "bsnl", "mtnl", "recharge", "postpaid",
                           "prepaid", "sim", "talktime", "validity", "data pack"],
    "internet charges": ["internet", "broadband", "wifi", "act fibernet", "leased line",
                         "hathway", "tikona"],
    "electricity charges - factory": ["electricity", "tneb", "power bill", "energy charges",
                                      "eb bill", "electric supply"],
    "travelling expenses": ["travel", "taxi", "cab", "ola", "uber", "rapido",
                            "auto", "auto rickshaw", "flight", "air ticket",
                            "airlines", "indigo", "spicejet", "air india",
                            "boarding pass", "train", "irctc", "railway",
                            "bus ticket", "apsrtc", "tsrtc", "ksrtc", "volvo",
                            "makemytrip", "yatra", "goibibo", "cleartrip",
                            "toll", "toll plaza", "fastag", "nhai", "parking",
                            "metro", "trip sheet", "pickup", "drop", "fare",
                            "kms", "distance", "boarding", "pnr", "seat no"],
    "foreign travelling expenses": ["visa", "foreign travel", "international flight"],
    "car hire charges": ["car hire", "car rental", "vehicle hire", "self drive"],
    "freight outward": ["freight outward", "outward freight", "transport outward", "delivery charges"],
    "freight inward": ["freight inward", "inward freight", "transport inward", "lorry freight"],
    "transportation charges": ["transport", "lorry", "truck", "logistics", "carriage", "tempo"],
    "loading & unloading": ["loading", "unloading", "hamali", "coolie", "labour loading"],
    "repairs & maintenance": ["repair", "maintenance", "servicing", "service",
                              "spare replacement", "amc", "labour charge repair",
                              "welding", "painting", "plumbing", "electrical work",
                              "carpentry", "puncture", "tyre", "tyres", "mrf",
                              "ceat", "apollo tyres", "battery", "exide", "amaron",
                              "wheel alignment", "wheel balancing", "oil change",
                              "engine oil", "greasing", "brake", "clutch",
                              "denting", "workshop", "garage", "mechanic",
                              "wire", "cable", "mcb", "switch", "socket", "bulb",
                              "led light", "tube light", "fan repair", "motor rewinding",
                              "paint", "primer", "cement", "plywood", "hinge",
                              "lock", "tap", "pipe", "cpvc", "upvc", "hardware"],
    "factory maintenance": ["factory repair", "plant maintenance", "housekeeping factory"],
    "garden maintenance": ["garden", "landscaping", "plants", "nursery"],
    "security service charges": ["security", "guard", "watchman", "securitas"],
    "professional  fees": ["professional fee", "consultant", "ca fee", "advocate",
                           "audit fee", "chartered accountant", "cs fee"],
    "consultancy charges": ["consultancy", "advisory", "consulting"],
    "legal and technical charges": ["legal", "lawyer", "court fee", "notary", "stamp paper"],
    "insurance": ["insurance", "policy premium", "new india assurance", "icici lombard",
                  "bajaj allianz", "hdfc ergo", "united india"],
    "vehicle insurance": ["motor insurance", "vehicle policy", "car insurance"],
    "bank charges": ["bank charge", "processing fee", "neft charge", "rtgs charge",
                     "cheque return", "commission bank"],
    "subscription": ["subscription", "saas", "annual fee", "licence renewal",
                     "membership", "zoho", "microsoft", "google workspace"],
    "gsuite-email operation": ["gsuite", "google workspace", "email hosting"],
    "advertisement expenses": ["advertisement", "advertising", "hoarding", "banner", "ad spend"],
    "business promotion expenses": ["promotion", "gift", "sponsorship", "corporate gift"],
    "pooja expenses": ["pooja", "puja", "temple", "prasadam", "festival",
                       "flowers", "garland", "coconut", "camphor", "agarbatti",
                       "incense", "kumkum", "archana", "abhishekam", "homam"],
    "donation": ["donation", "charity", "contribution", "trust"],
    "house rent": ["house rent", "residence rent", "staff quarters"],
    "rent": ["rent", "lease rental", "premises rent", "godown rent", "office rent"],
    "property tax": ["property tax", "municipal tax", "panchayat tax"],
    "licence, rates & taxes": ["licence", "license", "registration fee", "renewal fee",
                               "government fee", "challan"],
    "pollution control board consent": ["pollution", "tnpcb", "consent to operate"],
    "roc charges": ["roc", "mca", "registrar of companies", "form filing"],
    "contract labour wages": ["contract labour", "contractor wages", "manpower supply"],
    "labour charges- mfg.": ["labour charges", "job work", "fabrication labour"],
    "wages-confirmed": ["wages", "salary staff", "payroll"],
    "lab testing charges": ["testing", "lab test", "sample test", "nabl", "inspection"],
    "jcb / crane hire charges": ["jcb", "crane", "hydra", "forklift hire", "excavator"],
    "purchase of consumables": ["consumable", "chemical", "resin", "adhesive", "abrasive"],
    "purchase  -  oil, spares and tools": ["spares", "tools", "bearing", "lubricant",
                                           "grease", "hydraulic oil", "cutting tool", "blade"],
    "purchase  - packing material": ["packing", "carton", "pallet", "stretch film",
                                     "strapping", "bubble wrap", "wooden crate"],
    "purchase of raw material": ["raw material", "quartz", "resin raw", "silica", "pigment"],
    "sanitary items": ["sanitary", "toilet", "cleaning material", "phenyl",
                       "detergent", "housekeeping material", "harpic", "lizol",
                       "dettol", "soap", "handwash", "sanitizer", "tissue",
                       "napkin", "broom", "mop", "dustbin", "garbage bag",
                       "naphthalene", "air freshener", "bleaching"],
    "lab materials": ["lab material", "laboratory", "reagent"],
    "fumigation charges": ["fumigation", "pest control", "termite"],
    "container packing": ["container", "stuffing", "cfs", "shipping line"],
    "ocean freight charges - export": ["ocean freight", "sea freight", "bl charges"],
    "shipping & freight charges import": ["import freight", "customs freight", "cha charges"],
    "commission": ["commission", "brokerage", "agent commission"],
    "discount allowed": ["discount allowed", "rebate given"],
    "late fee on gst": ["late fee", "gst late", "penalty gst"],
    "interest on tds /others": ["tds interest", "interest tds"],
    "computers & peripherals": ["computer", "laptop", "desktop", "monitor", "keyboard",
                                "mouse", "ssd", "ram", "printer", "ups"],
    "air conditioner": ["ac unit", "air conditioner", "split ac", "voltas", "blue star"],
    "camera": ["cctv", "camera", "dvr", "nvr", "surveillance"],
    "mobiles": ["mobile phone", "smartphone", "handset", "iphone", "samsung galaxy"],

    # LPG cylinders for the canteen/factory - the bill names the gas company.
    "rent - gas": ["indane", "hp gas", "bharatgas", "bharat gas", "lpg",
                   "cylinder", "gas refill", "domestic gas", "commercial gas"],
    "factory maintenance": ["housekeeping", "cleaning contract", "deep cleaning",
                            "pest control factory", "floor cleaning", "scrap removal"],
    "loading & unloading": ["hamali", "loading charge", "unloading charge",
                            "coolie", "manual labour", "shifting charges"],
    "bank charges": ["ledger folio", "sms charges", "atm fee",
                     "annual maintenance charge", "cheque book", "imps",
                     "neft", "rtgs", "processing fee"],
    "office equipments": ["mouse", "keyboard", "pendrive", "pen drive", "usb",
                          "hard disk", "hdd", "ssd", "monitor", "webcam",
                          "extension box", "power strip", "spike guard"],
    "advertisement": ["flex", "flex printing", "banner printing", "signage",
                      "sign board", "vinyl", "sticker printing", "brochure",
                      "pamphlet", "catalogue"],
    "business promotion": ["diwali gift", "gift box", "dry fruits", "sweets box",
                           "calendar printing", "diary printing", "new year gift"],
}


def _attach_aliases(ledgers: list[Ledger]) -> None:
    """Attach seed vocabulary, MOST SPECIFIC matching key only.

    A ledger can match several keys at once. "Fuel Expenses - DG Set" matches
    both "fuel expenses" and "fuel expenses - dg set", and taking both gave the
    generator-diesel ledger the whole vehicle-fuel vocabulary - enough for a
    petrol-pump receipt to be coded to the DG set.

    So when one matching key is contained in another, the longer one wins. The
    general key still applies to ledgers that have no more specific match, which
    is what lets "Fuel Expenses - Varun Mundra" inherit fuel vocabulary.
    """
    for l in ledgers:
        key = normalise(l.name)
        matched = [sk for sk in SEED_ALIASES if normalise(sk) in key]
        specific = [
            sk for sk in matched
            if not any(other is not sk and normalise(sk) in normalise(other)
                       for other in matched)
        ]
        for sk in specific:
            l.aliases.extend(SEED_ALIASES[sk])
        l.aliases = sorted(set(l.aliases))


def save_json(ledgers: list[Ledger], path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps([l.to_dict() for l in ledgers], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_json(path: str | Path) -> list[Ledger]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for d in data:
        d.pop("search_text", None)
        out.append(Ledger(**d))
    return out


def postable_for_purchase(ledgers: list[Ledger]) -> list[Ledger]:
    """Candidate debit ledgers for a purchase voucher."""
    return [l for l in ledgers if l.is_postable and l.nature in PURCHASE_DEBIT_NATURES]


if __name__ == "__main__":
    import sys

    src = sys.argv[1] if len(sys.argv) > 1 else "data/Trial Balance - PESPL.xlsx"
    out = sys.argv[2] if len(sys.argv) > 2 else "data/ledgers.json"
    ls = load_from_trial_balance(src)
    save_json(ls, out)
    cand = postable_for_purchase(ls)
    print(f"parsed {len(ls)} rows -> {out}")
    print(f"  postable: {sum(1 for l in ls if l.is_postable)}")
    print(f"  purchase-debit candidates: {len(cand)}")
    print(f"  with seed aliases: {sum(1 for l in ls if l.aliases)}")
    from collections import Counter
    print("  by nature:", dict(Counter(l.nature for l in ls)))

// Ledger master, ported from automation/app/ledgers.py + automation/app/master_xml.py.
//
// Two sources, same output shape:
//   1. Tally "All Masters" XML export (authoritative - MASTER.xml)
//   2. Trial Balance .xlsx export (bootstrap, used for the pilot)
//
// This module is pure: it never touches the filesystem or a database. The
// caller reads MASTER.xml (or the spreadsheet cells) and hands the content in;
// what comes back is the ledger list everything downstream - classification,
// voucher building, the claimant dropdown - already agrees on.
//
// WHY REGEX AND NOT AN XML PARSER (for MASTER.xml)
// ------------------------------------------------
// Tally's export is 30 MB and not reliably well-formed: it emits raw control
// characters (&#4; prefixes on classification names), and unescaped ampersands
// appear in real ledger names. A conforming XML parser raises on the first one
// and you get nothing. Streaming regex over the text gets everything, and the
// only structure we need is NAME and PARENT.

// ---------------------------------------------------------------------------
// Normalisation - the single spelling every comparison in the engine uses.
// ---------------------------------------------------------------------------

export const STOPWORDS = new Set([
  "a/c", "ac", "account", "accounts", "and", "the", "of", "for", "to",
  "&", "-", "expenses", "expense", "charges", "charge",
]);

/** Lowercase, strip punctuation and Excel artefacts, collapse whitespace. */
export function normalise(text: string | null | undefined): string {
  if (!text) return "";
  let t = text.replace(/_x000D_/g, " ").replace(/\r/g, " ").replace(/\n/g, " ");
  t = t.toLowerCase();
  t = t.replace(/[^a-z0-9\s/&.-]/g, " ");
  t = t.replace(/\s+/g, " ");
  return t.trim();
}

/** Meaningful tokens only - drops stopwords and pure numbers. */
export function tokenise(text: string | null | undefined): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && t.length > 2 && !/^\d+$/.test(t));
}

// ---------------------------------------------------------------------------
// Nature - which side of the chart of accounts a ledger lives on.
//
// A food bill must never be able to match an equity ledger; filtering by
// nature removes ~60% of the search space for free before any text matching.
// ---------------------------------------------------------------------------

/** Root groups as they appear in a Trial Balance export. Prefix-matched. */
export const ROOT_NATURE: Record<string, string> = {
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
};

/**
 * Tally's built-in primary groups, mapped to the nature the classifier
 * filters on. These 28 names are fixed in every Tally company, which is what
 * makes the mapping safe to hard-code.
 */
export const PRIMARY_NATURE: Record<string, string> = {
  "capital account": "equity",
  "current assets": "asset",
  "current liabilities": "liability",
  "direct expenses": "expense",
  "direct incomes": "income",
  "fixed assets": "asset",
  "indirect expenses": "expense",
  "indirect incomes": "income",
  "investments": "asset",
  "loans (liability)": "liability",
  "misc. expenses (asset)": "asset",
  "purchase accounts": "expense",
  "sales accounts": "income",
  "suspense a/c": "other",
  "branch / divisions": "other",
  "duties & taxes": "liability",
  "bank accounts": "asset",
  "bank od a/c": "liability",
  "cash-in-hand": "asset",
  "deposits (asset)": "asset",
  "loans & advances (asset)": "asset",
  "provisions": "liability",
  "reserves & surplus": "equity",
  "secured loans": "liability",
  "unsecured loans": "liability",
  "stock-in-hand": "asset",
  "sundry creditors": "liability",
  "sundry debtors": "asset",
};

/** Ledgers a purchase voucher may legitimately debit. */
export const PURCHASE_DEBIT_NATURES = new Set(["expense", "asset"]);

export interface Ledger {
  name: string;
  parent: string | null;
  rootGroup: string;
  path: string[];
  nature: string;
  isPostable: boolean;
  indent: number;
  debit?: number | null;
  credit?: number | null;
  aliases: string[];
  /**
   * Name plus ancestry plus aliases - what the matchers actually score
   * against. Including ancestry matters: the ledger 'Insurance' is ambiguous
   * alone, but 'Insurance ADMINISTRATION EXPENSES Expenses (Indirect)' is not.
   *
   * Stored rather than computed (the Python makes it a live property) because
   * a TS interface has no properties; it is recomputed by the parsers after
   * aliases are attached. Call refreshSearchText if you mutate aliases.
   */
  searchText: string;
  /**
   * ADDITION over the Python (which never reads it): the ledger's GST
   * registration from MASTER.xml. It is how claimants are told apart from
   * businesses - a company that invoices PESPL is GST-registered; someone
   * claiming a taxi fare is not.
   */
  gstin?: string;
}

export function refreshSearchText(l: Ledger): void {
  l.searchText = normalise(
    [l.name, ...l.path.slice(0, -1), ...l.aliases].join(" "),
  );
}

function rootNature(rootGroup: string): string {
  const key = normalise(rootGroup);
  for (const [prefix, nature] of Object.entries(ROOT_NATURE)) {
    if (key.startsWith(normalise(prefix))) return nature;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Seed aliases
//
// Cold-start is the weak point of any learning system. Without these, the
// first few hundred bills all land in the review queue and the team loses
// faith in the tool before the learning loop has anything to learn from.
//
// Keys are matched against ledger names case-insensitively (substring).
//
// PORT NOTE: the Python source defines "factory maintenance",
// "loading & unloading" and "bank charges" TWICE; a Python dict literal keeps
// only the second definition, so that is what is reproduced here. The first
// "bank charges" vocabulary ("neft charge", "cheque return", ...) was dead
// code in production and stays dead here.
// ---------------------------------------------------------------------------
export const SEED_ALIASES: Record<string, string[]> = {
  // Reimbursements are dominated by food, fuel and travel, so those three get
  // the most vocabulary. Every word here was chosen because it appears on the
  // bill itself - dish names, pump terminology, ride-hailing brands - rather
  // than because it describes the accounting category. The bill says
  // "Chicken Biryani", never "Boarding & Lodging".
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
  // Key is "fuel expenses", NOT "fuel expenses vehicle". PESPL tracks fuel
  // per claimant and per vehicle - "Fuel Expenses - Varun Mundra",
  // "Fuel Expenses - Vehicle Bolero TN70 AP3179" - and a narrower key gave
  // those ledgers no fuel vocabulary at all, so a fuel bill could never match
  // the ledger it actually belongs to.
  "fuel expenses": ["petrol", "diesel", "fuel", "hsd", "ms petrol",
    "bharat petroleum", "indian oil", "iocl", "bpcl",
    "hpcl", "hindustan petroleum", "shell", "nayara",
    "reliance petroleum", "essar", "jio-bp", "iol",
    "petrol pump", "filling station", "fuel station",
    "service station", "petroleum", "oil corporation",
    // Pump printout vocabulary - these words appear on
    // almost every Indian fuel receipt and nowhere else.
    "nozzle", "preset", "density", "kg/m3", "litre",
    "ltrs", "volume", "vehicle no", "odometer",
    "fip", "pump no", "attendant", "fuel type"],
  "fuel expenses - dg set": ["dg diesel", "generator fuel", "genset diesel"],
  // Heavily used at PESPL (521 journal lines) but absent from the collapsed
  // trial balance. Staff refreshments and canteen bills belong here rather
  // than in Boarding & Lodging.
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
  "loading & unloading": ["hamali", "loading charge", "unloading charge",
    "coolie", "manual labour", "shifting charges"],
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
  "factory maintenance": ["housekeeping", "cleaning contract", "deep cleaning",
    "pest control factory", "floor cleaning", "scrap removal"],
  "garden maintenance": ["garden", "landscaping", "plants", "nursery"],
  "security service charges": ["security", "guard", "watchman", "securitas"],
  "professional  fees": ["professional fee", "consultant", "ca fee", "advocate",
    "audit fee", "chartered accountant", "cs fee"],
  "consultancy charges": ["consultancy", "advisory", "consulting"],
  "legal and technical charges": ["legal", "lawyer", "court fee", "notary", "stamp paper"],
  "insurance": ["insurance", "policy premium", "new india assurance", "icici lombard",
    "bajaj allianz", "hdfc ergo", "united india"],
  "vehicle insurance": ["motor insurance", "vehicle policy", "car insurance"],
  "bank charges": ["ledger folio", "sms charges", "atm fee",
    "annual maintenance charge", "cheque book", "imps",
    "neft", "rtgs", "processing fee"],
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

  // LPG cylinders for the canteen/factory - the bill names the gas company.
  "rent - gas": ["indane", "hp gas", "bharatgas", "bharat gas", "lpg",
    "cylinder", "gas refill", "domestic gas", "commercial gas"],
  "office equipments": ["mouse", "keyboard", "pendrive", "pen drive", "usb",
    "hard disk", "hdd", "ssd", "monitor", "webcam",
    "extension box", "power strip", "spike guard"],
  "advertisement": ["flex", "flex printing", "banner printing", "signage",
    "sign board", "vinyl", "sticker printing", "brochure",
    "pamphlet", "catalogue"],
  "business promotion": ["diwali gift", "gift box", "dry fruits", "sweets box",
    "calendar printing", "diary printing", "new year gift"],
};

/**
 * Attach seed vocabulary, MOST SPECIFIC matching key only.
 *
 * A ledger can match several keys at once. "Fuel Expenses - DG Set" matches
 * both "fuel expenses" and "fuel expenses - dg set", and taking both gave the
 * generator-diesel ledger the whole vehicle-fuel vocabulary - enough for a
 * petrol-pump receipt to be coded to the DG set.
 *
 * So when one matching key is contained in another, the longer one wins. The
 * general key still applies to ledgers that have no more specific match, which
 * is what lets "Fuel Expenses - Varun Mundra" inherit fuel vocabulary.
 */
export function attachAliases(ledgers: Ledger[]): void {
  const seedKeys = Object.keys(SEED_ALIASES);
  for (const l of ledgers) {
    const key = normalise(l.name);
    const matched = seedKeys.filter((sk) => key.includes(normalise(sk)));
    const specific = matched.filter(
      (sk) => !matched.some(
        (other) => other !== sk && normalise(other).includes(normalise(sk)),
      ),
    );
    for (const sk of specific) l.aliases.push(...SEED_ALIASES[sk]);
    l.aliases = [...new Set(l.aliases)].sort();
    refreshSearchText(l);
  }
}

// ---------------------------------------------------------------------------
// Source 1: Trial Balance export
//
// The trial balance encodes Tally's group tree as Excel indent levels. Those
// indents are NOT clean in a real Tally export - they jump 0 -> 2 -> 4 -> 3
// -> 5 rather than nesting by one. So indent is treated as a *relative*
// signal: pop the parent stack until we find a strictly smaller indent. That
// reconstructs the tree correctly despite the noise.
// ---------------------------------------------------------------------------

/** One spreadsheet row as the caller read it: first-column value and its
 *  alignment indent, plus the debit/credit columns. The Python reads these
 *  through openpyxl; here the spreadsheet I/O stays with the caller so the
 *  module needs no xlsx dependency (SheetJS CE cannot read indents anyway). */
export interface TrialBalanceRow {
  value: string | null;
  indent: number;
  debit?: unknown;
  credit?: unknown;
}

function num(v: unknown): number | null {
  // Python float(): None -> None, non-numeric strings -> None.
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const TB_SKIP = new Set(["grand total", "debit", "credit", "closing balance", "opening balance"]);

/** Parse a Tally Trial Balance export (as raw rows) into a ledger list. */
export function parseTrialBalanceRows(rows: TrialBalanceRow[]): Ledger[] {
  // Find the header row ("Particulars") - rows above it are company letterhead.
  let start = 0;
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    if (normalise(String(rows[i].value ?? "")) === "particulars") {
      start = i + 1;
      break;
    }
  }

  const raw: Array<[number, string, number | null, number | null]> = [];
  for (let i = start; i < rows.length; i++) {
    const name = String(rows[i].value ?? "").replace(/_x000D_/g, "").trim();
    if (!name) continue;
    if (TB_SKIP.has(normalise(name))) continue;
    raw.push([rows[i].indent | 0, name, num(rows[i].debit), num(rows[i].credit)]);
  }

  // Rebuild the tree. Stack holds (indent, name); pop until strictly smaller.
  const ledgers: Ledger[] = [];
  const stack: Array<[number, string]> = [];
  for (const [indent, name, debit, credit] of raw) {
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    const path = [...stack.map((s) => s[1]), name];
    const parent = stack.length ? stack[stack.length - 1][1] : null;
    const root = path[0];
    ledgers.push({
      name,
      parent,
      rootGroup: root,
      path,
      nature: rootNature(root),
      isPostable: true, // corrected below
      indent,
      debit,
      credit,
      aliases: [],
      searchText: "",
    });
    stack.push([indent, name]);
  }

  // A row with children is a group header. Tally rejects vouchers posted to
  // a group, so those are marked non-postable.
  const parents = new Set(ledgers.map((l) => l.parent).filter(Boolean));
  for (const l of ledgers) {
    if (parents.has(l.name) || l.indent === 0) l.isPostable = false;
  }

  attachAliases(ledgers);
  return ledgers;
}

// ---------------------------------------------------------------------------
// Source 2: Tally "All Masters" XML export - the authoritative ledger master.
//
// This replaces the Trial Balance bootstrap entirely. The trial balance was a
// *report*: Tally collapses it, so PESPL's export listed 443 rows and silently
// omitted 510 ledgers the team uses daily - 22.8% of all journal lines went to
// a ledger the dashboard could not even offer. The masters export is the
// actual chart of accounts: 2,538 ledgers, 169 groups, every parent recorded.
//
//     Gateway of Tally -> Alt+E (Export) -> Masters
//       Report:  All Masters
//       Format:  XML
//       -> MASTER.xml
// ---------------------------------------------------------------------------

const LEDGER_RE = /<LEDGER\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi;
const GROUP_RE = /<GROUP\s+NAME="([^"]*)"[^>]*>([\s\S]*?)<\/GROUP>/gi;
const PARENT_RE = /<PARENT>([\s\S]*?)<\/PARENT>/i;
const GSTIN_TAG_RE = /<PARTYGSTIN>([\s\S]*?)<\/PARTYGSTIN>/i;
const CTRL_RE = /&#(\d+);/g;

/** Decode one numeric character reference, dropping only control chars. */
function numRef(_m: string, digits: string): string {
  const n = parseInt(digits, 10);
  if (n < 32 && n !== 9 && n !== 10 && n !== 13) {
    return ""; // Tally's own prefixes: &#4; etc.
  }
  return n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

/**
 * Undo XML entities and drop Tally's control-character prefixes.
 *
 * Numeric references are DECODED, not deleted: "Café" is exported as
 * "Caf&#233;", and deleting the reference silently renamed the ledger to
 * "Caf" - which then failed to match Tally on import. Only genuine control
 * characters are dropped. &amp; is undone last so "&amp;#8377;" survives as
 * the literal text "&#8377;" rather than becoming a rupee sign.
 *
 * INTERNAL WHITESPACE IS PRESERVED EXACTLY. 33 ledgers in PESPL's chart of
 * accounts genuinely contain double spaces - "Veena  SK", "GAYATHRI  R" - and
 * Tally matches ledger names byte for byte. Collapsing them produced a name
 * Tally does not have, so the voucher failed to import, and the export
 * preview offered to CREATE the collapsed spelling as a brand new ledger
 * beside the real one. Matching stays whitespace-insensitive because
 * normalise() collapses both sides at lookup time - that is the layer that
 * canonicalises a clerk's "Travelling  Expenses" to the master spelling,
 * not this one.
 */
export function unescapeTally(s: string): string {
  if (!s) return "";
  let t = s.replace(CTRL_RE, numRef);
  t = t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return t.trim();
}

function parentOf(block: string): string {
  const m = PARENT_RE.exec(block);
  return m ? unescapeTally(m[1]) : "";
}

/**
 * Parse an All Masters export (the file CONTENT - the caller reads the file)
 * into the same Ledger shape the rest of the app already uses, so nothing
 * downstream changes.
 */
export function loadFromMasterXml(xmlText: string): Ledger[] {
  const groups = new Map<string, string>();
  for (const m of xmlText.matchAll(GROUP_RE)) {
    groups.set(unescapeTally(m[1]), parentOf(m[2]));
  }

  // Later duplicates overwrite earlier ones, as a Python dict would.
  const raw = new Map<string, { parent: string; gstin: string }>();
  for (const m of xmlText.matchAll(LEDGER_RE)) {
    const name = unescapeTally(m[1]);
    if (name) {
      const g = GSTIN_TAG_RE.exec(m[2]);
      raw.set(name, {
        parent: parentOf(m[2]),
        gstin: g ? unescapeTally(g[1]) : "",
      });
    }
  }

  /** Walk up to the primary group. Guards against a cycle, which a
   *  hand-edited export can contain. */
  const ancestry = (groupName: string): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur = groupName;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.push(cur);
      cur = groups.get(cur) ?? "";
    }
    return chain;
  };

  const natureOf = (chain: string[]): string => {
    // Walk from the primary group DOWNWARDS: the outermost known primary
    // decides. "FUEL EXPENSES VEHICLE" under "Indirect Expenses" is an
    // expense however deeply nested it is.
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = PRIMARY_NATURE[normalise(chain[i])];
      if (n) return n;
    }
    return "other";
  };

  const out: Ledger[] = [];
  const names = [...raw.keys()].sort(); // Python sorted(): code-point order
  for (const name of names) {
    const { parent, gstin } = raw.get(name)!;
    const chain = parent ? ancestry(parent) : [];
    const path = [...chain].reverse().concat([name]);
    out.push({
      name,
      parent: parent || null,
      rootGroup: path[0],
      path,
      nature: natureOf(chain),
      // Every LEDGER in Tally is postable by definition - groups are
      // separate <GROUP> elements. This is the big correctness win over the
      // trial balance, where group headers and ledgers were the same kind of
      // row and had to be guessed apart by indentation.
      isPostable: true,
      indent: path.length - 1,
      aliases: [],
      searchText: "",
      ...(gstin ? { gstin } : {}),
    });
  }

  attachAliases(out);
  return out;
}

export interface MasterSummary {
  total: number;
  byNature: Record<string, number>;
  withAliases: number;
  reimbursable: number;
}

export function summarise(ledgers: Ledger[]): MasterSummary {
  const byNature: Record<string, number> = {};
  for (const l of ledgers) byNature[l.nature] = (byNature[l.nature] ?? 0) + 1;
  return {
    total: ledgers.length,
    byNature,
    withAliases: ledgers.filter((l) => l.aliases.length > 0).length,
    reimbursable: ledgers.filter((l) => l.nature === "expense" || l.nature === "asset").length,
  };
}

/** Candidate debit ledgers for a purchase voucher. */
export function postableForPurchase(ledgers: Ledger[]): Ledger[] {
  return ledgers.filter((l) => l.isPostable && PURCHASE_DEBIT_NATURES.has(l.nature));
}

// ---------------------------------------------------------------------------
// Claimants - who can be reimbursed. Ported from app/main.py's
// configured_people / people_list, minus the live-Tally branch (network I/O
// belongs to the caller; pass its result in `used` or pre-empt it entirely
// with `configured`).
// ---------------------------------------------------------------------------

/** The configured allowlist, trimmed and de-duplicated, order preserved. */
export function configuredPeople(raw: ReadonlyArray<unknown> | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of raw ?? []) {
    const t = String(n).trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Staff who can be reimbursed.
 *
 * An explicit allowlist wins outright: most companies reimburse a handful of
 * people, and picking them out of 608 Tally creditors is the slowest part of
 * filing a stack of bills. With no list, the ledger master itself is the
 * source - the All Masters export records every ledger's parent, so the
 * claimant list is available with no live connection at all. Names already
 * used on past bills are merged in so the dropdown still works when the
 * master is stale.
 */
export function peopleList(opts: {
  configured?: ReadonlyArray<unknown> | null;
  ledgers?: readonly Ledger[];
  peopleGroup?: string | null;
  used?: Iterable<string>;
}): string[] {
  const allow = configuredPeople(opts.configured);
  if (allow.length) {
    // Python sorts with key=str.casefold: case-insensitive, stable.
    return allow
      .map((name, i) => [name.toLowerCase(), i, name] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]))
      .map((t) => t[2]);
  }
  const group = (opts.peopleGroup ?? "").trim().toLowerCase();
  const fromMaster = (opts.ledgers ?? [])
    .filter((l) => (l.parent ?? "").trim().toLowerCase() === group)
    .map((l) => l.name);
  const merged = new Set<string>(fromMaster);
  for (const p of opts.used ?? []) if (p) merged.add(p);
  return [...merged].sort();
}

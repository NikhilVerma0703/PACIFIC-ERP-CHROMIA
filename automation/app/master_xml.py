"""
Read Tally's "All Masters" XML export - the authoritative ledger master.

This replaces the Trial Balance bootstrap entirely. The trial balance was a
*report*: Tally collapses it, so PESPL's export listed 443 rows and silently
omitted 510 ledgers the team uses daily - 22.8% of all journal lines went to a
ledger the dashboard could not even offer. The masters export is the actual
chart of accounts: 2,538 ledgers, 169 groups, every parent recorded.

    Gateway of Tally -> Alt+E (Export) -> Masters
      Report:  All Masters
      Format:  XML
      -> MASTER.xml

WHY REGEX AND NOT AN XML PARSER
-------------------------------
Tally's export is 30 MB and not reliably well-formed: it emits raw control
characters (&#4; prefixes on classification names), and unescaped ampersands
appear in real ledger names. ElementTree raises on the first one and you get
nothing. Streaming regex over the text gets everything, and the only structure
we need is NAME and PARENT.
"""
from __future__ import annotations

import re
from pathlib import Path

from .ledgers import Ledger, _attach_aliases, normalise

# Tally's built-in primary groups, mapped to the nature the classifier filters
# on. These 28 names are fixed in every Tally company, which is what makes the
# mapping safe to hard-code.
PRIMARY_NATURE = {
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
}

_LEDGER_RE = re.compile(r'<LEDGER\s+NAME="([^"]*)"[^>]*>(.*?)</LEDGER>', re.S | re.I)
_GROUP_RE = re.compile(r'<GROUP\s+NAME="([^"]*)"[^>]*>(.*?)</GROUP>', re.S | re.I)
_PARENT_RE = re.compile(r"<PARENT>(.*?)</PARENT>", re.S | re.I)
_CTRL_RE = re.compile(r"&#(\d+);")


def _num_ref(m: "re.Match[str]") -> str:
    """Decode one numeric character reference, dropping only control chars."""
    n = int(m.group(1))
    if n < 32 and n not in (9, 10, 13):
        return ""                       # Tally's own prefixes: &#4; etc.
    return chr(n) if n <= 0x10FFFF else ""


def unescape(s: str) -> str:
    """Undo XML entities and drop Tally's control-character prefixes.

    Numeric references are DECODED, not deleted: "Café" is exported as
    "Caf&#233;", and deleting the reference silently renamed the ledger to
    "Caf" - which then failed to match Tally on import. Only genuine control
    characters are dropped. &amp; is undone last so "&amp;#8377;" survives as
    the literal text "&#8377;" rather than becoming a rupee sign.
    """
    if not s:
        return ""
    s = _CTRL_RE.sub(_num_ref, s)
    s = (s.replace("&lt;", "<").replace("&gt;", ">")
          .replace("&quot;", '"').replace("&apos;", "'")
          .replace("&amp;", "&"))
    return re.sub(r"\s+", " ", s).strip()


def _parent_of(block: str) -> str:
    m = _PARENT_RE.search(block)
    return unescape(m.group(1)) if m else ""


def load_from_master_xml(path: str | Path) -> list[Ledger]:
    """Parse an All Masters export into the same Ledger shape the rest of the
    app already uses, so nothing downstream changes."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")

    groups: dict[str, str] = {}
    for m in _GROUP_RE.finditer(text):
        groups[unescape(m.group(1))] = _parent_of(m.group(2))

    raw: dict[str, str] = {}
    for m in _LEDGER_RE.finditer(text):
        name = unescape(m.group(1))
        if name:
            raw[name] = _parent_of(m.group(2))

    def ancestry(group_name: str) -> list[str]:
        """Walk up to the primary group. Guards against a cycle, which a
        hand-edited export can contain."""
        chain: list[str] = []
        seen: set[str] = set()
        cur = group_name
        while cur and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            cur = groups.get(cur, "")
        return chain

    def nature_of(chain: list[str]) -> str:
        # Walk from the primary group DOWNWARDS: the outermost known primary
        # decides. "FUEL EXPENSES VEHICLE" under "Indirect Expenses" is an
        # expense however deeply nested it is.
        for g in reversed(chain):
            n = PRIMARY_NATURE.get(normalise(g))
            if n:
                return n
        return "other"

    out: list[Ledger] = []
    for name, parent in sorted(raw.items()):
        chain = ancestry(parent) if parent else []
        path = list(reversed(chain)) + [name]
        out.append(Ledger(
            name=name,
            parent=parent or None,
            root_group=path[0] if path else name,
            path=path,
            nature=nature_of(chain),
            # Every LEDGER in Tally is postable by definition - groups are
            # separate <GROUP> elements. This is the big correctness win over
            # the trial balance, where group headers and ledgers were the same
            # kind of row and had to be guessed apart by indentation.
            is_postable=True,
            indent=len(path) - 1,
        ))

    _attach_aliases(out)
    return out


def summarise(ledgers: list[Ledger]) -> dict:
    from collections import Counter
    return {
        "total": len(ledgers),
        "by_nature": dict(Counter(l.nature for l in ledgers)),
        "with_aliases": sum(1 for l in ledgers if l.aliases),
        "reimbursable": sum(1 for l in ledgers
                            if l.nature in ("expense", "asset")),
    }


if __name__ == "__main__":
    import json
    import sys
    from .ledgers import save_json

    src = sys.argv[1] if len(sys.argv) > 1 else "data/MASTER.xml"
    out = sys.argv[2] if len(sys.argv) > 2 else "data/ledgers.json"
    ls = load_from_master_xml(src)
    save_json(ls, out)
    s = summarise(ls)
    print(f"parsed {s['total']} ledgers -> {out}")
    print(f"  reimbursable (expense/asset): {s['reimbursable']}")
    print(f"  with seed aliases           : {s['with_aliases']}")
    print(f"  by nature: {json.dumps(s['by_nature'])}")

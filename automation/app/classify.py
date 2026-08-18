"""
Ledger classification - four signals, no LLM.

    Signal 1  Vendor memory        weight 0.50, short-circuits
    Signal 2  Fuzzy string match   weight 0.20
    Signal 3  TF-IDF cosine        weight 0.20
    Signal 4  Char n-gram cosine   weight 0.10

Why four rather than one: they fail in different places. Fuzzy matching handles
transposition and OCR noise but treats every word as equally important, so
"Charges" (in 15 ledger names) counts as much as "Fumigation" (in one). TF-IDF
fixes exactly that through inverse document frequency, but needs whole words to
survive OCR. Character n-grams need only fragments, so they hold up when whole
words do not, but they also match on coincidental letter overlap. Averaging
them cancels the individual failure modes.

Vendor memory outranks all three because it is not a guess. If this vendor's
bills went to this ledger the last five times, that is a fact about your
business, and no amount of text similarity should overrule it.

The output is always a ranked list with scores and a human-readable reason -
never a single silent answer. An auditor asking "why is this coded to Boarding
& Lodging?" gets "vendor HOTEL SITARA GRAND matched 5 previous bills", which is
a real answer.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from rapidfuzz import fuzz

from .ledgers import Ledger, normalise, tokenise

# Five signals now. "person" was added because it is free intelligence: the
# claimant is chosen at upload, so this signal exists BEFORE the bill is read.
# A driver claims fuel and tolls; a salesperson claims travel and hotels. Over a
# few hundred claims that habit is a strong prior.
#
# Its weight is deliberately modest. A person's history narrows the field, it
# does not decide - anyone can occasionally claim something unusual, and a
# person signal strong enough to override the bill text would code every one of
# their claims to their most common ledger.
WEIGHTS = {"memory": 0.42, "person": 0.14, "fuzzy": 0.18, "tfidf": 0.16, "ngram": 0.10}

# How often a ledger is really used is NOT one of the weighted signals. It was,
# briefly, and that was wrong: as an additive term it let a ledger with zero
# text relevance score 28% on popularity alone. "RoDTEP Receivable" (1,804 uses,
# an export-incentive account) started appearing as the second suggestion for
# restaurant bills.
#
# Usage is a TIE-BREAKER. It multiplies a score the text already supports,
# within a deliberately narrow band, so it can reorder near-equal candidates but
# can never promote something nothing else points at.
USAGE_FLOOR = 0.78     # never used in any journal
USAGE_CEILING = 1.10   # among the most-used ledgers

BANDS = [(0.85, "high"), (0.60, "medium"), (0.35, "low")]

# Confirmations of the same vendor->ledger pair before memory is treated as
# near-certain. One confirmation could be a clerk clicking through carelessly;
# three is a pattern.
MEMORY_TRUST_COUNT = 3


@dataclass
class Suggestion:
    ledger: str
    score: float
    band: str
    reasons: list[str] = field(default_factory=list)
    signals: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "ledger": self.ledger, "score": round(self.score, 3), "band": self.band,
            "reasons": self.reasons,
            "signals": {k: round(v, 3) for k, v in self.signals.items()},
        }


def band_for(score: float, bands: dict | None = None) -> str:
    if bands:
        for name in ("high", "medium", "low"):
            if name in bands and score >= bands[name]:
                return name
        return "none"
    for threshold, name in BANDS:
        if score >= threshold:
            return name
    return "none"


# --------------------------------------------------------------------------
# Query construction
#
# Feeding the raw OCR dump to the matchers does not work. A receipt is ~300
# tokens of address, phone numbers, GST registration, table numbers, "Thank you
# visit again" - and perhaps four tokens that say what was actually bought. A
# ledger name is two or three words. Cosine similarity between a long noisy
# document and a short label is tiny no matter how good the match is, which
# compressed every real score into the 0.05-0.16 range and made the confidence
# bands meaningless.
#
# So the bill is reduced to the words that carry purchase meaning before any
# matching happens. Same algorithms, an order of magnitude better separation.
# --------------------------------------------------------------------------
BOILERPLATE = set("""
total amount net gross sub subtotal gst cgst sgst igst utgst cess tax taxable
invoice bill number date time qty quantity rate item items description desc
inr rupees rupee cash card upi paid due balance change round off amt
thank you thanks visit again please welcome come customer name address
phone mobile contact tel fax email www http com pin code state city road
street floor colony nagar layout main cross opp near behind
gstin fssai licence license reg regn cin pan tin
table covers cashier user assign counter token kot bill no sno srno
terms conditions optional service charges are computer generated signature
original duplicate triplicate recipient copy jurisdiction subject
""".split())


def build_query_text(ocr_text: str, vendor_name: str | None = None,
                     line_items: list[dict] | None = None,
                     max_tokens: int = 60) -> str:
    """Reduce a bill to the words that indicate what was purchased.

    The vendor name is repeated because it is the strongest single clue on a
    small bill - 'HOTEL SITARA GRAND' says more about the correct ledger than
    the entire rest of the receipt.
    """
    parts: list[str] = []

    if vendor_name:
        parts.extend([normalise(vendor_name)] * 3)

    # Line items are literally a description of what was bought.
    for it in (line_items or []):
        desc = it.get("description") if isinstance(it, dict) else None
        if desc:
            parts.append(normalise(desc))

    kept: list[str] = []
    for tok in tokenise(ocr_text):
        if tok in BOILERPLATE or tok in STOPWORDS_EXTRA:
            continue
        if any(c.isdigit() for c in tok):
            continue
        if len(tok) < 3:
            continue
        kept.append(tok)
        if len(kept) >= max_tokens:
            break
    parts.extend(kept)

    return " ".join(p for p in parts if p)


STOPWORDS_EXTRA = {"the", "and", "for", "with", "from", "this", "that", "was",
                   "are", "not", "all", "your", "our", "has", "have"}


def name_match_person(ledger_name: str, person: str) -> int:
    """Does this ledger appear to be named after the claimant?

    PESPL has per-person expense ledgers - "Fuel Expenses - Varun Mundra",
    "Fuel Expenses - Hemanth". Matching them to the claimant is one of the
    highest-value cheap wins available, because the person is known at upload.

    Returns the NUMBER of matching name tokens, not a yes/no, because a
    forename alone is ambiguous in a real chart of accounts. PESPL has both
    "Fuel Expenses - Varun Mundra" and "Fuel Expenses - Varun Somani": matching
    on "varun" alone picked the wrong colleague's ledger, which would post one
    person's fuel against another's account. Counting tokens lets a two-word
    match outrank a one-word match.

    Matching is per token rather than on the whole string because Tally ledgers
    are often abbreviated relative to the party name - the ledger reads "Fuel
    Expenses - Hemanth" while the claimant is "HEMANTH KUMAR REDDY". Tokens must
    be at least 4 characters, so initials and short words cannot match.
    """
    if not ledger_name or not person:
        return 0
    led = set(normalise(ledger_name).split())
    return sum(1 for tok in set(normalise(person).split())
               if len(tok) >= 4 and tok in led)


def vendor_key(vendor_name: str | None, gstin: str | None) -> str:
    """Stable identity for a vendor.

    GSTIN is preferred whenever present: it is exact, it survives OCR noise in
    the trading name, and it does not drift when a vendor rebrands. Falling
    back to a normalised name means 'HOTEL SITARA GRAND' and 'Hotel Sitara
    Grand.' collapse to the same key.
    """
    if gstin and len(gstin) == 15:
        return f"gstin:{gstin.upper()}"
    if vendor_name:
        n = normalise(vendor_name)
        n = re.sub(r"\b(pvt|private|ltd|limited|llp|inc|co|company|and|the)\b", " ", n)
        n = re.sub(r"\s+", " ", n).strip()
        if n:
            return f"name:{n}"
    return ""


class LedgerClassifier:
    def __init__(self, ledgers: list[Ledger], memory: "Memory | None" = None,
                 weights: dict | None = None, bands: dict | None = None,
                 memory_trust_count: int | None = None,
                 usage: dict[str, int] | None = None):
        self.all_ledgers = ledgers
        self.memory = memory
        # Weights and bands come from config.yaml when supplied. They used to be
        # module constants while config.yaml carried its own copy - so tuning the
        # config changed nothing, which is worse than having no setting at all.
        self.weights = {**WEIGHTS, **(weights or {})}
        self.bands = bands or {}
        self.memory_trust_count = memory_trust_count or MEMORY_TRUST_COUNT

        # How often each ledger is really used, from Tally's Journal Register.
        # Log-scaled: the gap between 0 and 50 uses matters enormously, the gap
        # between 500 and 4,000 barely at all - both are simply "live".
        self.usage = usage or {}
        if self.usage:
            top = math.log1p(max(self.usage.values()))
            self.usage_score = {k: math.log1p(v) / top for k, v in self.usage.items()}
        else:
            self.usage_score = {}

        self.candidates: list[Ledger] = [l for l in ledgers if l.is_postable]
        self._corpus = [l.search_text for l in self.candidates]
        self._names = [l.name for l in self.candidates]

        # Word-level TF-IDF. sublinear_tf dampens the effect of a word repeating
        # many times in a long bill, which would otherwise swamp the signal.
        self._word_vec = TfidfVectorizer(
            analyzer="word", ngram_range=(1, 2), sublinear_tf=True, min_df=1
        )
        self._word_mat = self._word_vec.fit_transform(self._corpus)

        # Character n-grams, word-boundary aware. This is the OCR-noise backstop.
        self._char_vec = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=1
        )
        self._char_mat = self._char_vec.fit_transform(self._corpus)

    def _usage_multiplier(self, name: str) -> float:
        """Bounded tie-breaker on how often this ledger is really used."""
        if not self.usage:
            return 1.0
        frac = self.usage_score.get(name, 0.0)
        return USAGE_FLOOR + (USAGE_CEILING - USAGE_FLOOR) * frac

    # -- individual signals -------------------------------------------------
    def _tfidf_scores(self, text: str):
        return cosine_similarity(self._word_vec.transform([text]), self._word_mat)[0]

    def _ngram_scores(self, text: str):
        return cosine_similarity(self._char_vec.transform([text]), self._char_mat)[0]

    def _fuzzy_scores(self, text: str) -> list[float]:
        # token_set_ratio ignores word order and duplicate words, which is what
        # we want when comparing a whole bill against a short ledger name.
        return [fuzz.token_set_ratio(text, c) / 100.0 for c in self._corpus]

    # -- main ---------------------------------------------------------------
    def classify(
        self,
        bill_text: str,
        vendor_name: str | None = None,
        gstin: str | None = None,
        nature_filter: set[str] | None = None,
        top_k: int = 5,
        person: str | None = None,
    ) -> list[Suggestion]:
        text = normalise(bill_text)
        if not text:
            return []

        # Restrict to plausible natures first. A food bill should never be able
        # to reach an equity ledger, and removing those candidates up front
        # improves both accuracy and speed.
        nature_filter = nature_filter or {"expense", "asset"}
        allowed = [
            i for i, l in enumerate(self.candidates) if l.nature in nature_filter
        ]
        if not allowed:
            allowed = list(range(len(self.candidates)))

        tfidf = self._tfidf_scores(text)
        ngram = self._ngram_scores(text)
        fuzzy = self._fuzzy_scores(text)

        vkey = vendor_key(vendor_name, gstin)
        mem_scores, mem_counts = {}, {}
        if self.memory and vkey:
            mem_scores, mem_counts = self.memory.vendor_scores(vkey)

        person_scores, person_counts = {}, {}
        if self.memory and person:
            person_scores, person_counts = self.memory.person_scores(person)

        token_scores = {}
        if self.memory:
            token_scores = self.memory.token_scores(tokenise(bill_text))

        results: list[Suggestion] = []
        for i in allowed:
            ledger = self.candidates[i]
            name = ledger.name
            sig = {
                "memory": mem_scores.get(name, 0.0),
                "person": person_scores.get(name, 0.0),
                "fuzzy": fuzzy[i],
                "tfidf": float(tfidf[i]),
                "ngram": float(ngram[i]),
            }
            score = sum(self.weights.get(k, 0.0) * v for k, v in sig.items())
            sig["memory_count"] = mem_counts.get(name, 0)

            # Learned token associations act as a bonus rather than a fifth
            # weighted signal, so they can lift a ledger the text signals missed
            # but cannot on their own promote something nothing else supports.
            # Tie-break on real usage. Multiplicative and bounded, so it never
            # invents relevance.
            mult = self._usage_multiplier(name)
            score *= mult
            if mult != 1.0:
                sig["usage_x"] = mult

            # PERSON-NAMED LEDGERS.
            #
            # PESPL tracks fuel per claimant: "Fuel Expenses - Varun Mundra",
            # "Fuel Expenses - Hemanth", "Fuel Expenses - Pravin". When Varun
            # submits a fuel bill, the answer is HIS ledger, not a generic one -
            # and the generic "FUEL EXPENSES VEHICLE" has never been used at all.
            #
            # The claimant is known at upload, so this is free and close to
            # certain. It only fires when the text signals already point at this
            # ledger, so a person-named ledger cannot win on the name alone.
            if person and sig["tfidf"] + sig["fuzzy"] > 0.35:
                matched = name_match_person(name, person)
                if matched:
                    # Two matching name tokens is near-certain identity; one is
                    # suggestive but could be a colleague sharing a forename, so
                    # it gets a much smaller nudge.
                    score = min(1.0, score * (1.55 if matched >= 2 else 1.12))
                    sig["person_named"] = float(matched)

            tok = token_scores.get(name, 0.0)
            if tok:
                score += 0.15 * tok
                sig["tokens"] = tok

            reasons = []
            pcnt = person_counts.get(name, 0)
            if pcnt >= 2 and person:
                reasons.append(
                    f"{person} has claimed this ledger {pcnt} times before")
            cnt = mem_counts.get(name, 0)
            if cnt:
                reasons.append(
                    f"This vendor was coded here {cnt} time{'s' if cnt != 1 else ''} before"
                )
            used = self.usage.get(name, 0)
            if self.usage and not used:
                reasons.append("Never used in your Tally journals")
            if sig["tfidf"] > 0.25:
                reasons.append(f"Bill wording matches this ledger ({sig['tfidf']:.0%} similarity)")
            if sig["fuzzy"] > 0.75 and not reasons:
                reasons.append(f"Ledger name closely matches the bill text ({sig['fuzzy']:.0%})")
            if ledger.aliases and any(a in text for a in ledger.aliases):
                hit = next(a for a in ledger.aliases if a in text)
                reasons.append(f"Bill mentions '{hit}'")
                score += 0.08
            if tok:
                reasons.append("Similar past bills were coded here")

            score = min(1.0, score)
            results.append(
                Suggestion(name, score, band_for(score), reasons or ["Weak text similarity"], sig)
            )

        results.sort(key=lambda s: -s.score)
        _calibrate(results, bands=self.bands,
                   trust_count=self.memory_trust_count)
        if results and self.usage:
            used = self.usage.get(results[0].ledger, 0)
            if used >= 25:
                results[0].reasons.append(
                    f"Used {used} times in your Tally journals")

        # Short-circuit: a well-established vendor mapping wins outright.
        if mem_counts:
            best_mem = max(mem_counts.items(), key=lambda kv: kv[1])
            if best_mem[1] >= self.memory_trust_count:
                for r in results:
                    if r.ledger == best_mem[0]:
                        r.score = max(r.score, 0.93)
                        r.band = band_for(r.score)
                        r.reasons.insert(
                            0, f"Confirmed mapping - this vendor has gone to "
                               f"{best_mem[0]} {best_mem[1]} times"
                        )
                        results.remove(r)
                        results.insert(0, r)
                        break

        return results[:top_k]


# ---------------------------------------------------------------------------
# Calibration
#
# Raw ensemble scores are not probabilities and do not span 0-1. Even a clearly
# correct match lands around 0.30-0.45, because a short ledger name can only
# overlap so much with a bill. Handing those numbers to a clerk as "16%
# confident" is both wrong and destroys trust in the tool.
#
# Two things actually indicate a reliable answer:
#
#   absolute strength  - how strong is the top match on its own
#   margin             - how much better is it than the runner-up
#
# Margin matters as much as strength. A top score of 0.30 with the next
# candidate at 0.05 is a confident answer; 0.30 with the next at 0.28 is a coin
# flip, and the clerk should be told so.
#
# STRONG_RAW is the raw score treated as fully convincing. It is deliberately
# conservative and should be re-tuned once a few hundred confirmations exist:
# compare the raw score of confirmed-correct suggestions against corrected ones
# and set it near the crossover.
# ---------------------------------------------------------------------------
STRONG_RAW = 0.42

# Confidence ceiling by how many times this vendor->ledger pair has been
# confirmed. Without this, a SINGLE confirmation produces a 100% "high"
# suggestion - the memory signal dominates the ensemble and the margin over the
# runner-up becomes enormous.
#
# That is not acceptable. One confirmation could be a clerk clicking through
# carelessly, and a system that treats one click as certainty will propagate
# that mistake to every future bill from the vendor. Evidence has to accumulate
# before the tool is allowed to sound certain, so the ceiling rises with the
# count and only reaches the "high" band at MEMORY_TRUST_COUNT.
MEMORY_CONFIDENCE_CEILING = {0: 1.00, 1: 0.70, 2: 0.82}


def _calibrate(results: list[Suggestion], bands: dict | None = None,
               trust_count: int = MEMORY_TRUST_COUNT) -> None:
    if not results:
        return
    raw_top = results[0].score
    raw_second = results[1].score if len(results) > 1 else 0.0

    for i, r in enumerate(results):
        raw = r.score
        r.signals["raw"] = round(raw, 3)
        absolute = min(1.0, raw / STRONG_RAW)
        if i == 0:
            margin = (raw_top - raw_second) / raw_top if raw_top > 1e-6 else 0.0
            conf = 0.60 * absolute + 0.40 * min(1.0, margin * 1.6)
        else:
            # Runners-up are scored on strength alone; they have no margin.
            conf = absolute * 0.75

        count = int(r.signals.get("memory_count", 0))
        if count < trust_count:
            ceiling = MEMORY_CONFIDENCE_CEILING.get(count, 1.0)
            if conf > ceiling:
                conf = ceiling
                if count:
                    r.reasons.append(
                        f"Confidence capped until this vendor has been confirmed "
                        f"{trust_count} times ({count} so far)"
                    )

        r.score = round(min(1.0, conf), 3)
        r.band = band_for(r.score, bands)


# ---------------------------------------------------------------------------
# Memory - the self-learning part
# ---------------------------------------------------------------------------
class Memory:
    """Learned associations, backed by SQLite.

    Learning happens on CONFIRMATION only - never on suggestion. The system
    learns from what a human accepted or corrected, not from what it guessed.

    Two structures:
      vendor_memory  vendor -> ledger -> count. Specific and strong.
      token_weights  token  -> ledger -> weight. Generalises across vendors, so
                     'biryani' eventually points at the right ledger no matter
                     which restaurant issued the bill.

    Corrections decay the previous mapping rather than merely adding to the new
    one. Without decay a wrong mapping learned early keeps competing forever.
    """

    DECAY = 0.55

    def __init__(self, conn):
        self.conn = conn

    def vendor_scores(self, vkey: str) -> tuple[dict[str, float], dict[str, int]]:
        rows = self.conn.execute(
            "SELECT ledger, count FROM vendor_memory WHERE vendor_key = ?", (vkey,)
        ).fetchall()
        if not rows:
            return {}, {}
        counts = {r["ledger"]: r["count"] for r in rows}
        total = sum(counts.values())
        # Saturating score: 1 confirmation ~0.55, 3 ~0.79, 6 ~0.90. Combined
        # with share of this vendor's history, so a contested vendor scores
        # lower than a consistent one.
        scores = {
            led: (1 - math.exp(-0.8 * c)) * (0.5 + 0.5 * c / total)
            for led, c in counts.items()
        }
        return scores, counts

    def person_scores(self, person: str) -> tuple[dict[str, float], dict[str, int]]:
        """Which ledgers this person's claims have gone to.

        Normalised by the person's own total rather than saturating like the
        vendor signal, because the useful information is the SHARE: "70% of
        Vijay's claims are fuel" is a prior worth acting on, whereas the raw
        count only says he claims a lot.
        """
        rows = self.conn.execute(
            "SELECT ledger, count FROM person_memory WHERE person = ?",
            (person.strip(),)).fetchall()
        if not rows:
            return {}, {}
        counts = {r["ledger"]: r["count"] for r in rows}
        total = sum(counts.values()) or 1
        # Damped by total history so a person with 2 claims does not look as
        # certain as one with 200.
        confidence = min(1.0, total / 12.0)
        scores = {led: (c / total) * confidence for led, c in counts.items()}
        return scores, counts

    def learn_person(self, person: str, ledger: str,
                     source: str = "confirmed", weight: int = 1) -> None:
        if not person or not ledger:
            return
        self.conn.execute(
            "INSERT INTO person_memory(person, ledger, count, last_seen, source) "
            "VALUES (?,?,?,datetime('now'),?) "
            "ON CONFLICT(person, ledger) DO UPDATE SET "
            "count = count + ?, last_seen = datetime('now')",
            (person.strip(), ledger, weight, source, weight))

    def token_scores(self, tokens: list[str]) -> dict[str, float]:
        if not tokens:
            return {}
        marks = ",".join("?" * len(tokens))
        rows = self.conn.execute(
            f"SELECT ledger, SUM(weight) w FROM token_weights "
            f"WHERE token IN ({marks}) GROUP BY ledger", tokens
        ).fetchall()
        if not rows:
            return {}
        top = max(r["w"] for r in rows) or 1.0
        return {r["ledger"]: min(1.0, r["w"] / top) for r in rows}

    def learn(self, vkey: str, ledger: str, bill_text: str,
              suggested: str | None = None, user: str = "system",
              person: str | None = None) -> None:
        """Record a confirmed classification."""
        c = self.conn
        if person:
            self.learn_person(person, ledger)
        if vkey:
            c.execute(
                "INSERT INTO vendor_memory(vendor_key, ledger, count, last_seen) "
                "VALUES (?,?,1,datetime('now')) "
                "ON CONFLICT(vendor_key, ledger) DO UPDATE SET "
                "count = count + 1, last_seen = datetime('now')",
                (vkey, ledger),
            )
            # A correction means the old mapping was wrong here. Decay it so it
            # stops competing, but do not delete it - the vendor may genuinely
            # use two ledgers and the counts should reflect the real split.
            if suggested and suggested != ledger:
                c.execute(
                    "UPDATE vendor_memory SET count = MAX(1, CAST(count * ? AS INTEGER)) "
                    "WHERE vendor_key = ? AND ledger = ?",
                    (self.DECAY, vkey, suggested),
                )

        for tok in set(tokenise(bill_text)):
            c.execute(
                "INSERT INTO token_weights(token, ledger, weight) VALUES (?,?,1.0) "
                "ON CONFLICT(token, ledger) DO UPDATE SET weight = weight + 1.0",
                (tok, ledger),
            )
            if suggested and suggested != ledger:
                c.execute(
                    "UPDATE token_weights SET weight = weight * ? "
                    "WHERE token = ? AND ledger = ?",
                    (self.DECAY, tok, suggested),
                )

        if suggested and suggested != ledger:
            c.execute(
                "INSERT INTO corrections(field, suggested, chosen, vendor_key, "
                "created_by, created_at) VALUES ('ledger',?,?,?,?,datetime('now'))",
                (suggested, ledger, vkey, user),
            )
        c.commit()

    def learned_mappings(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT vendor_key, ledger, count, last_seen FROM vendor_memory "
            "ORDER BY count DESC, last_seen DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def forget(self, vkey: str, ledger: str) -> None:
        """Admin override. Everything the system infers must be undoable."""
        self.conn.execute(
            "DELETE FROM vendor_memory WHERE vendor_key = ? AND ledger = ?",
            (vkey, ledger),
        )
        self.conn.commit()

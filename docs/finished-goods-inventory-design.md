# Finished-Goods Inventory — Phase 1 Detailed DB Design

**Scope now:** the finished-goods slab record + QC autolink + location (bay/frame) + design merge + audit/history + size + bulk-upload provision + dashboard.
**Deferred (Phase 1b):** Packing & Dispatch detail — provisioned in the model, fleshed out when you send examples/format.

---

## Model 1 — `FinishedSlab` (native table `fg_finished_slab`)

One row **per physical slab**, keyed by the globally-unique `slabNumber`. QC upserts on this key (re-polish / re-QC updates the same row — never a new one). Fields grouped by **who owns them**.

```prisma
model FinishedSlab {
  id            String   @id @default(cuid())
  slabNumber    Int      @unique @map("slab_number")   // globally-unique INTEGER; non-integer QC slabs (e.g. insert 144338.1) are flagged, never auto-added

  // ── QC-owned: overwritten every time the slab passes QC ──
  design         String?  @map("design")               // raw; grouped for the dashboard via DesignAlias (canonical)
  grade          String?  @map("grade")                // A / A2 / B / C / CTS / Printing  (one field, QC form)
  slabThickness  String?  @map("slab_thickness")        // 1.2 cm / 2 cm / 3 cm / 7 mm
  polishType     String?  @map("polish_type")           // Polish / Suede / Honed / Leathered  (QC form)  ← NEW
  rwStatus       String?  @map("rw_status")             // drives "Pending R/W"
  repolishStatus String?  @map("repolish_status")       // drives "Pending Polishing"
  batchNumber    String?  @map("batch_number")
  batchKey       String?  @map("batch_key")
  barcode        String?  @map("barcode")               // barcode/QR-ready stable key (from PolishQc.barcode)
  qcInspector    String?  @map("qc_inspector")
  lastQcAt       DateTime? @map("last_qc_at")           // most-recent QC pass
  lengthIn       Float?   @default(137) @map("length_in")  // QC full-slab default 137" × 79"; cut pieces (fab module) out of scope
  widthIn        Float?   @default(79)  @map("width_in")   // sqft = L×W/144 (default ≈ 75.16), sqm = sqft × 0.092903 — both derived

  // ── Location: Bay set at QC · Frame set by Dispatch · Frame cleared on re-QC ──
  bayNumber      String?  @map("bay_number")            // assigned in the QC form
  frameNumber    String?  @map("frame_number")          // assigned by the dispatch team

  // ── Inventory-owned: NEVER overwritten by QC ──
  status               SlabStatus @default(AVAILABLE) @map("status")   // lifecycle
  reservedForPi        String?    @map("reserved_for_pi")
  customer             String?    @map("customer")
  reservedAt           DateTime?  @map("reserved_at")
  reservationExpiresAt DateTime?  @map("reservation_expires_at")  // default reservedAt + 7 days; only ADMIN may override
  notes                String?    @map("notes")          // commercial note (separate from QC remarks)

  // ── Provenance / stock-age ──
  source        SlabSource @default(QC_AUTOLINK) @map("source")  // QC_AUTOLINK | BULK_UPLOAD
  firstSeenAt   DateTime @default(now()) @map("first_seen_at")   // entered finished goods; stock-age = now − firstSeenAt
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  events        SlabEvent[]

  @@index([batchKey]) @@index([status]) @@index([grade])
  @@map("fg_finished_slab")
}

enum SlabStatus { AVAILABLE RESERVED PACKED DISPATCHED RETURNED }
enum SlabSource { QC_AUTOLINK BULK_UPLOAD }
```

**Convention note:** `grade`, `polishType`, `slabThickness` are `String` (validated by an app-level option list, exactly like your existing `PolishQc.qualityGrade`) rather than DB enums — so QC can add/adjust values without a migration. Only the internal lifecycle (`status`, `source`) is a hard enum.

---

## Model 2 — `DesignAlias` (native `fg_design_alias`) — your "merge two design names"

```prisma
model DesignAlias {
  id        String   @id @default(cuid())
  variant   String   @unique @map("variant")    // e.g. "CALACATTA GOLD"
  canonical String   @map("canonical")           // e.g. "Calacatta Gold"
  createdBy String?  @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([canonical])
  @@map("fg_design_alias")
}
```

Design-wise stock and search group by **canonical** (fall back to the raw `design` when no alias). "Merge two designs" = add `variant → canonical`. Non-destructive (grouped at read-time, so it's reversible; we don't rewrite the slab rows).

---

## Model 3 — `SlabEvent` (native `fg_slab_event`) — audit + location history + "changed today/week" feed

One append-only log that serves three of your requirements at once.

```prisma
model SlabEvent {
  id         String   @id @default(cuid())
  slabNumber Float    @map("slab_number")
  slab       FinishedSlab @relation(fields: [slabNumber], references: [slabNumber])
  kind       String   @map("kind")        // created | qc_update | location | status | reserve | pack | dispatch | return
  field      String?  @map("field")        // e.g. "bayNumber", "status"
  oldValue   String?  @map("old_value")
  newValue   String?  @map("new_value")
  changedBy  String?  @map("changed_by")
  source     String?  @map("source")       // QC form | Inventory | Dispatch | Bulk upload
  at         DateTime @default(now()) @map("at")
  @@index([slabNumber]) @@index([at])
  @@map("fg_slab_event")
}
```

- **Audit trail** — who / when / from where, on every status, location, and dispatch change.
- **Location movement** (incl. moving between bays) — a `kind:"location"` event with old→new bay+frame; the dispatch "move slabs from one location to another" screen writes these.
- **"New slabs added or changed during the day / week / month"** — just query events by `at` range.

---

## QC → Inventory autolink (the default going forward)

On **QC form save** (after the `PolishQc` row is written), **upsert `FinishedSlab` on `slabNumber`**:

- **Update (QC-owned):** design, grade, slabThickness, **polishType**, rwStatus, repolishStatus, batch/batchKey, barcode, qcInspector, lastQcAt, **bayNumber** (from the QC form), sqft (if entered at QC) — and **reset `frameNumber = null`** (location clears on re-QC, per your rule; dispatch re-assigns it).
- **Create (first time only):** + `status = AVAILABLE`, `source = QC_AUTOLINK`, `firstSeenAt = now`.
- **Never touch:** status, reservedForPi, customer, reservationExpiresAt, notes.
- Write a `SlabEvent` (`created` or `qc_update`).
- **Skipped slabs** (numbers never produced on the machine) are simply never created — no-op.
- **Integer-only guard:** a non-integer QC slab number (e.g. insert `144338.1`) is **not** auto-added — it is skipped and written to a review feed (`SlabEvent kind:"flagged_non_integer"`) so finished-goods numbers stay whole. Same on bulk upload.

## QC-form additions

- **Bay** (new) → sets `FinishedSlab.bayNumber`.
- **Polish type** (new) → Polish / Suede / Honed / Leathered.
- **Grade** — extend the existing QC grade options to **A / A2 / B / C / CTS / Printing** (reject/C slabs are kept — usable in smaller sizes).
- **Size** — default full slab **137″ × 79″** (≈ 75.16 sqft) auto-filled at QC, overridable per slab. Cut-to-size pieces are the fab module's domain.

## Bulk upload (legacy stock) — provisioned now

`FinishedSlab.source = BULK_UPLOAD`. A one-shot importer upserts on `slabNumber`, normalises design (via `DesignAlias`), grade, thickness, polishType, sqft, bay; and returns a reconciliation report (created / updated / skipped / conflicts). Exact column format wired once you send the file.

---

## Packing & Dispatch — Phase 1b (stub, model-ready)

Not designed in detail yet, but the slab table already carries the hooks so nothing here changes the core:
`status` (RESERVED / PACKED / DISPATCHED / RETURNED), `reservedForPi`, `customer`, `reservationExpiresAt`.

Planned shape (to confirm with your examples): `PackingList` (manual container no, PI, customer, draft|dispatched) → `Crate` (1–10, dropdown) → slabs per crate; generated lists sit in a subsection to delete or dispatch; on dispatch slabs → DISPATCHED + linked to Invoice + customer + PI. Supports **partial dispatch** (a PI across multiple containers) and **returns / un-dispatch** (→ RETURNED, back to AVAILABLE).

---

## Dashboard — every KPI maps to the model

| KPI | Derivation |
|---|---|
| Total Slabs | `count(FinishedSlab)` |
| Grade A / B / C (and A2) | `count by grade` |
| Available / Packed / Dispatched | `count by status` |
| Packed — for which PI/Customer | `status=PACKED` grouped by `reservedForPi`, `customer` |
| Pending for Polishing | `repolishStatus = 'Repolish Required'` |
| Pending R/W | `rwStatus = 'RW Required and ongoing'` |
| Stock for CTS / Printing | `grade in (CTS, Printing)` and `status = AVAILABLE` |
| Design-wise stock | group by `canonical(design)` |
| Stock-age | `now − firstSeenAt` |
| Search (Colour/Batch/Thickness/Grade/Slab#/Bay/Status) | direct `FinishedSlab` filters |
| "In production / was at Polish Entry 2 hrs ago" | reuse `slabReport.ts` / `detailedReport.ts` station timeline |

---

## Resolved decisions

- **Grade** — one exclusive value per slab (A / A2 / B / C / CTS / Printing).
- **Size** — QC default full slab **137″ × 79″** (≈ 75.16 sqft); sqm derived (× 0.092903). Cut pieces handled by the fab module.
- **`slabNumber` = Int** (integer-only). Non-integer QC/upload slabs are flagged, never auto-added.
- **Reservation expiry** — 7 days by default; only Admin may override.

## Still open

- **Packing / Dispatch** — awaiting your examples + packing-list format (Phase 1b).
- **Excel bulk-upload columns** — awaiting the file.
- **Upstream anomalies (non-blocking, not in QC):** `144338.1` (insert slab) and `126281.445` (error) exist only in Press/Oven/Jot — they don't affect finished goods. The `126281.445` one looks worth correcting at source; I can do that separately on your say-so.

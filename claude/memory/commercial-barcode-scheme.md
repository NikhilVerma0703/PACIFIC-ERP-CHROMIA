---
name: commercial-barcode-scheme
description: Pacific's Dutch customer builds EAN-13s as GS1 prefix 8720847 + a running 5-digit item reference; the series skips 17227 and must never reuse it.
metadata:
  type: project
---

The customer behind `Desert Silk Crate BARCODE.docx` builds every barcode the
same way, decoded 2026-09-12 from the nine valid codes on that sheet:

```
8720847 · 17222 · 8
  |         |      +--  check digit, computed
  |         +---------  item reference, 5 digits, running 17222 … 17232
  +-------------------  GS1 company prefix, 7 digits (872 = GS1 Netherlands)
```

Three facts worth not rediscovering:

* **The series skips 17227.** `allocateEan13` in `src/lib/commercial/barcode.ts`
  always goes ABOVE the highest reference in use and never fills that gap — a
  gap is far likelier to be a code the customer issued where we cannot see it
  than a free slot, and a reissued EAN fails at their gate like a duplicate.
  Next code is `8720847172334`; `8720847172273` must never be produced.
* **Their sheet contains a real duplicate.** `220x19.5x2` and `220x15x2` both
  read `8720847172266`. The EAN column is now UNIQUE, so the losing row stores
  with no code and an `eanBlockedReason`, and that client's labels do not print
  until the owner says which size owns it. Still unresolved.
* **Prefix length varies by customer.** It is stored per client in
  `commercial_client_barcode`; the item reference takes whatever is left of the
  twelve digits, so a 9-digit prefix leaves 3.

The label is pasted on the 2 cm EDGE of the piece. No magnification in the legal
0.80–2.00 band fits a full-height EAN-13 under 20 mm, so the bars are truncated
and the module width is NOT reduced. See [[commercial-module-decisions]].

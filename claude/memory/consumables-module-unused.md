---
name: consumables-module-unused
description: Pacific ERP consumables is now actively being built out (sign-off sheet, dropdown-only panel, migrations 0074/0075 applied) but both data tables still hold zero rows.
metadata:
  type: project
---

Consumables in Pacific ERP was dormant until 2026-09-04/05, when another
session built the batch sign-off sheet (per-station usage, who was there,
quantity, unit_price/priced_by), made the machine-form quick-log panel
dropdown-only with the store's list enforced server-side, and applied
scripts/0074 and 0075 (eight new columns on consumable_consumption_entry,
UNIQUE(lower(itemName)) on inventory_stock). The owner clearly wants it now.

Still true on 2026-09-05: consumable_inventory_stock and
consumable_consumption_entry both hold ZERO rows. Every screen renders its
empty state and the store has not added a first item.

**Why:** an adversarial review found ten "certain" defects in that work, all
with zero live impact only because the tables are empty — a floor line editable
to a different item without the stock following, a replayed request able to
decrement resin from a machine form, the 2x mark firing on a 10%-slow design.
They bite the day the store adds its first item.

**How to apply:** the quick-log panel decrements real stock; the sign-off sheet
must never decrement. Direct materials (resin, grit) are received against
invoices and must be refused at a machine form on the SERVER, not only hidden
from the picker. Do not judge a consumables bug by today's impact — judge it by
the first week of real data.

Related: [[mis-target-policy-standardisation]]

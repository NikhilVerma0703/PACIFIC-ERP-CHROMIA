---
name: neon-db-state
description: Neon production DB — NEON-01/02 + 0062 applied 2026-08-28; two backup_neon01_* rollback tables still exist and are safe to drop once the sampling module has bedded in.
metadata: 
  node_type: memory
  type: project
  originSessionId: 74c27030-f48c-4296-8b07-072a3508cd02
  modified: 2026-08-28T06:33:47.617Z
---

On 2026-08-28 the sampling-module DB push was applied to Neon production (project morning-glitter-72845667, db neondb): NEON-01 schema (via corrected copy — the original referenced nonexistent `finished_slab`, the real table is `fg_finished_slab`, and its Section 16 UPDATE used a LATERAL referencing the update target, which Postgres rejects; rewritten as DISTINCT ON), NEON-02 colour catalogue (7 series / 129 colours / 516 finishes), and scripts/0062 (sales_config.mail_bodies/mail_subjects + users.smtp_* — six columns the runbook missed that would have broken login). All verification queries pass; 23 wrongly-dispatchable cut slabs were repaired.

Cleanup pending: tables `backup_neon01_finished_slab_grade` and `backup_neon01_fab_slab_thickness` remain in Neon as the rollback snapshot (the runbook's Neon-branch step wasn't possible without console/API access). Drop them once the owner is confident:
`DROP TABLE backup_neon01_finished_slab_grade; DROP TABLE backup_neon01_fab_slab_thickness;`
Note: `prisma migrate diff` will keep listing them (and known sales/consumable FK drift) — that drift is documented as normal in schema.prisma; never run `prisma db push`.

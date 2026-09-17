---
name: fab-single-operator-model
description: Pacific ERP fabrication runs on ONE operator login covering all machines and all projects — not one login per machine.
metadata: 
  node_type: memory
  type: project
  originSessionId: b468d215-e1c8-422d-bc8e-0fe0c26136e5
  modified: 2026-08-07T07:55:09.866Z
---

Pacific ERP (C:\Users\user\Desktop\ERP), Fabrication module: the shop runs a single
operator account that works every station (cutting, polishing, sink-cutting,
fabrication, packaging) across all projects. Stated by the user 2026-08-07.

**Why:** the module was originally built around one operator login per machine —
`/fab/session` forced a machine pick and middleware locked that login to the one
queue URL. That model does not match how the floor actually works.

**How to apply:** treat `FabMachineSession` as optional attribution (it stamps
machineId for the CEO dashboard), never as a gate. Any new fab station page must
be added to the operator allowlist in `src/middleware.ts` and to the operator
sidebar in `src/app/fab/layout.tsx`, or it is unreachable for operators.

# Deploy & Cutover Runbook (Phases 7–8)

This runs on **your** accounts and machine. Do it after Phases 3–6 are tested locally.

## Target architecture (live)

- **App** → Vercel (Next.js)
- **Database** → Neon (managed Postgres) — same engine as local
- **Background jobs** → Inngest Cloud (the 37 automations)
- **File storage** → Vercel Blob (attachments)

---

## Phase 7 — Deploy

### 1. Database on Neon
1. Create a project at https://neon.tech → copy the **pooled** connection string.
2. It looks like `postgresql://USER:PASS@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
3. Apply the schema to Neon from your machine:
   ```bat
   set DATABASE_URL=<neon-pooled-url>
   npx prisma migrate deploy   :: or: npx prisma db push
   ```

### 2. Import data into Neon
Run the importer pointed at Neon (one-time, ~139K records):
```bat
set DATABASE_URL=<neon-url>
set AIRTABLE_PAT=<your-pat>
set AIRTABLE_BASE_ID=apppEYN8yX1wH3gwr
npm run import
```

### 3. GitHub
> Your notes flagged a pending repo transfer to `vmundra-pacific`. Two clean options:
> - **A:** finish recovering the `vmundra-pacific` account, accept the transfer, push there.
> - **B (simpler):** create a fresh repo under the account whose Vercel team you can log into, and push to it. Avoids the transfer entirely.

```bat
cd C:\Users\user\Desktop\ERP
git init && git add . && git commit -m "Pacific ERP"
git remote add origin <your-repo-url>
git push -u origin main
```
(`.env.local` is gitignored — secrets never leave your machine.)

### 4. Vercel
1. https://vercel.com/new → import the repo.
2. **Environment Variables** (Project → Settings → Environment Variables):
   - `DATABASE_URL` = Neon pooled URL
   - `AUTH_SECRET` = output of `npx auth secret`
   - `AUTH_URL` = your production URL (e.g. `https://pacific-erp.vercel.app`)
   - `AIRTABLE_PAT`, `AIRTABLE_BASE_ID` (for sync)
   - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (from step 5)
3. Deploy. Capture the production URL.

### 5. Inngest Cloud
1. https://app.inngest.com → create an app, copy the Event Key + Signing Key into Vercel env.
2. Add a **sync endpoint** pointing at `https://<your-app>/api/inngest`. Inngest discovers the functions and runs the schedules (e.g. the 6-hour wastage rollup) automatically.

### 6. Optional — embed in the marketing site
Like your current setup, set `NEXT_PUBLIC_PRODUCTION_DASHBOARD_URL` in the Pacific Surfaces project to the new app URL so `/production` iframes it. (Or point staff straight at the app URL.)

---

## Phase 8 — Cutover (parallel-run → forward-only freeze)

Per the agreed **Option A** strategy:

1. **Parallel run** (Phase 6 sync is live): Airtable stays the system of record; Postgres mirrors it. Compare daily — confirm the new automations produce the same numbers as Airtable (spot-check batch D1310 → 9.97% wastage).
2. **Train operators** on a few terminals using the new forms while Airtable still runs.
3. **Freeze date:** pick a shift boundary. Stop the Airtable→Postgres sync. From this moment, **all new data entry happens only in the new app.**
4. **Airtable becomes read-only archive** — keep it for historical reference; no new writes.
5. **Turn on** the Postgres-side scheduled automations in Inngest (wastage rollup, Slab Summary, etc.) — these finally populate the tables Airtable left empty.
6. **Backups:** enable Neon's point-in-time restore; schedule a weekly `pg_dump` to Blob/your storage.
7. **Monitor** the first week: Inngest dashboard for job failures, Vercel logs for errors.

### Rollback
If something breaks before the freeze, you simply keep using Airtable — nothing is lost because it was still the source of truth. After the freeze, rollback means re-enabling Airtable entry and re-syncing the gap; keep the freeze window short and well-monitored to make this unlikely.

---

## Cost (live, rough monthly)
Vercel Pro ~$20 · Neon ~$0–49 (scales with data/compute) · Inngest ~$0–20 · Blob a few dollars. Early on this can run near-free; budget ~$40–100/mo with headroom. The whole stack is Docker-portable, so self-hosting on a VPS (~$10–40/mo) stays an option later.

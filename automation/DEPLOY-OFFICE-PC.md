# Running the finance engine on the office PC

Two ways to run this. **Start with Option A.** It needs no tunnel, no firewall
change and no public hostname, and it produces exactly the same Tally XML.
Option B only adds the ability to drive the engine from `erp.pacific-surfaces.com`.

The engine never posts to Tally by itself either way. It emits an XML file that a
human imports (`O: Import → Transactions`). That step is manual by design, so
"no tunnel" costs you nothing in the accounting workflow.

---

## Option A — local only (recommended to start)

Everything runs on the office PC. The engine listens on loopback, the ERP runs on
the same machine, and nothing is exposed to the LAN or the internet.

```
[office PC]  browser → ERP (localhost:3000) → engine (127.0.0.1:8080) → XML file
                                                                          ↓
                                                              Tally (manual import)
```

### One-time setup

1. **Python 3.10+** and **Node 20+** installed.

2. **Tesseract OCR**:
   ```powershell
   winget install UB-Mannheim.TesseractOCR
   ```
   winget may install user-scoped to `%LOCALAPPDATA%\Programs\Tesseract-OCR`.
   The engine checks that path automatically — leave `ocr.tesseract_cmd: null`.

3. **Python dependencies**:
   ```powershell
   cd <repo>\automation
   python -m pip install -r requirements.txt
   ```

4. **Tally ledger master.** In Tally: Export → All Masters → XML. Save as
   `automation/data/MASTER.xml`. Without it the trial-balance bootstrap misses
   roughly 510 ledgers and imports get rejected on unknown names.

5. **Generate an API key and set it in both environments.** Never write it into
   `config.yaml` — that file is tracked in git.
   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
   Engine side (PowerShell, persists for the user):
   ```powershell
   setx FINANCE_ENGINE_KEY "<the key>"
   ```
   ERP side — `.env.local` in the repo root (gitignored):
   ```
   FINANCE_ENGINE_URL="http://localhost:8080"
   FINANCE_ENGINE_KEY="<the same key>"
   ```

6. **Node dependencies**: `npm install` in the repo root.

### Daily run

Two terminals, or make them services (below).

```powershell
# terminal 1 - the engine
cd <repo>\automation
python run.py

# terminal 2 - the ERP
cd <repo>
npm run dev
```

Open `http://localhost:3000/office/finance`. Upload the stack, confirm each bill,
export the batch, import the downloaded XML into Tally, then click **mark
imported** on the same page.

### Make it survive reboots

Simplest reliable option on Windows is Task Scheduler, one task per service:

- Trigger: **At log on** (or At startup, with "Run whether user is logged on or not")
- Action for the engine: program `python`, arguments `run.py`, start-in `<repo>\automation`
- Action for the ERP: program `npm`, arguments `run start`, start-in `<repo>`
  (run `npm run build` once first — `start` serves the production build and is
  much lighter than `dev`)
- Tick **Restart the task if it fails**

Confirm afterwards:
```powershell
Get-NetTCPConnection -LocalPort 8080,3000 -State Listen
```

---

## Option B — add a Cloudflare Tunnel

Only needed if people must use `erp.pacific-surfaces.com` (the Vercel
deployment) rather than the PC in the office. The engine keeps its loopback
binding; the tunnel makes outbound connections only, so no inbound firewall
rule and no port forwarding.

```
browser → ERP (Vercel) → https://finance.<your-domain> → cloudflared → 127.0.0.1:8080
```

1. **Install** on the office PC:
   ```powershell
   winget install Cloudflare.cloudflared
   ```

2. **Authenticate** — opens a browser, pick the zone for your domain:
   ```powershell
   cloudflared tunnel login
   ```

3. **Create the tunnel** and note the UUID it prints:
   ```powershell
   cloudflared tunnel create pacific-finance
   ```

4. **Route a hostname to it**:
   ```powershell
   cloudflared tunnel route dns pacific-finance finance.<your-domain>
   ```

5. **Config** at `%USERPROFILE%\.cloudflared\config.yml`:
   ```yaml
   tunnel: pacific-finance
   credentials-file: C:\Users\<user>\.cloudflared\<UUID>.json
   ingress:
     - hostname: finance.<your-domain>
       service: http://127.0.0.1:8080
     - service: http_status:404
   ```

6. **Run it as a service** so it starts with the PC:
   ```powershell
   cloudflared service install
   ```

7. **Point the ERP at it** — Vercel → Project → Settings → Environment Variables:
   ```
   FINANCE_ENGINE_URL = https://finance.<your-domain>
   FINANCE_ENGINE_KEY = <the same key the engine has>
   ```
   Redeploy for the change to take effect.

### Check it

```powershell
curl.exe -H "X-API-Key: <key>" https://finance.<your-domain>/api/v1/bills
```
- `200` — working.
- `401` — the tunnel is up but the two keys differ.
- `502`/`530` — the tunnel is up but `cloudflared` cannot reach the engine; check
  the engine is running on 8080.

### What the tunnel exposes

The hostname is public, so the API key is the only thing protecting an endpoint
that writes accounting vouchers. Therefore:

- keep `api.allow_unauthenticated: false` (shipped default)
- keep `app.ui_enabled: false` — those built-in pages have no login of their own
- use a long random key and rotate it if it is ever pasted into a chat or ticket

---

## Getting the data out without any of this

If you only need what has been scanned so far, you do not need the ERP at all.
With `FINANCE_ENGINE_KEY` set and `python run.py` running:

```powershell
# every bill the engine knows, as JSON
curl.exe -H "X-API-Key: $env:FINANCE_ENGINE_KEY" http://127.0.0.1:8080/api/v1/bills > bills.json

# a batch's Tally XML
curl.exe -H "X-API-Key: $env:FINANCE_ENGINE_KEY" http://127.0.0.1:8080/api/v1/export/<ref> > voucher.xml
```

Everything also lives on disk under `automation/data/`:

| Path | What |
|---|---|
| `finance.db` | SQLite: bills, OCR text, extracted fields, exports, audit |
| `uploads/` | the original uploaded PDFs and photos |
| `pages/` | per-page PNGs that OCR actually ran on |
| `tally_export/` | generated Tally XML, ready to import |

Back that folder up. It is the audit trail and it is not in git.

**Note:** only *confirmed* bills can be exported to XML. That gate is deliberate —
a human confirms three fields before anything can reach Tally — so a bill sitting
at `status: review` will not appear in an export until someone approves it.

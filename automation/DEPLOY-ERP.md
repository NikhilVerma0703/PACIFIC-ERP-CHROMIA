# Running the Finance Engine for the Pacific ERP

The ERP page **Office → Bill Automation** (`/office/finance`, Finance/Accounts/Admin
only) drives this engine through the ERP's server-side proxy
(`/api/office/finance/*`). The browser never talks to the engine directly and the
API key never leaves the two servers.

## Machine requirements

Runs on the office PC that can reach Tally. Needs:

1. **Python 3.10+** and `pip install -r requirements.txt`
2. **Tesseract OCR** — Windows installer: <https://github.com/UB-Mannheim/tesseract/wiki>
   (default install path is found automatically; or `winget install UB-Mannheim.TesseractOCR`)
3. The ledger master — put Tally's **All Masters** export at `data/MASTER.xml`
   (preferred; the Trial Balance xlsx bootstrap misses ~510 ledgers)

Start with `python run.py` — it preflights all of the above and prints what's missing.

## Wiring it to the ERP

1. Generate a key: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
2. Put it in `config.yaml` → `api.key`
3. Set the same value in the ERP's environment (Vercel → Project → Env):
   - `FINANCE_ENGINE_KEY` — the key
   - `FINANCE_ENGINE_URL` — where this engine is reachable *from the ERP servers*
4. **Set `app.ui_enabled: false` in config.yaml.** The engine's built-in pages have
   no login; with the flag off only the key-protected `/api/v1` exists, so nobody
   on the LAN can confirm bills or post to Tally by browsing to port 8080.

Because the ERP runs on Vercel (cloud), the engine must be reachable from the
internet. A **Cloudflare Tunnel** on the office PC is the recommended way — no
inbound firewall holes, and the tunnel hostname becomes `FINANCE_ENGINE_URL`.
For local ERP development, `http://localhost:8080` with an empty key works and
the engine warns about the missing key on every start.

## Day-to-day

- The XML never auto-posts. Finance downloads it from the ERP page, imports it in
  Tally (O: Import → Transactions), checks `Errors : 0`, then clicks
  **mark imported** on the same page.
- `python tests.py` — the engine's full self-check (runs without Tesseract).
- The SQLite DB, uploaded bill images and generated XMLs all live under `data/`
  on this machine — back that folder up; it is the audit trail.

# Making Bill Automation work on the live site

The finance page works on `localhost` and fails on `erp.pacific-surfaces.com`
with *"The finance engine is not reachable"*. This is not a bug and no code
change fixes it — it is the architecture, and this is the missing piece of it.

## Why it fails

The engine binds `127.0.0.1:8080` (`app.host` in `automation/config.yaml`). That
is deliberate: binding `0.0.0.0` would publish the whole accounting API to every
host on the office LAN.

The deployed ERP runs as Vercel functions. When one of them fetches
`FINANCE_ENGINE_URL`, `localhost` means *Vercel's own container* — not the office
PC. There is no route from Vercel to a loopback socket in your office, so the
fetch throws and the proxy returns its 502 banner.

Verified 2026-08-08: engine listening on `127.0.0.1:8080` only; nothing on the
office network is exposed publicly.

## The fix: Cloudflare Tunnel

`config.yaml:9` already names this as the intended production path. The tunnel
runs on the office machine, connects **outbound** to Cloudflare, and forwards to
`localhost:8080`. Nothing is port-forwarded, no firewall hole is opened, and the
engine keeps its loopback binding — so `automation/tests.py`'s
*"shipped config binds loopback, not the whole LAN"* assertion still passes.

```
Vercel function ──https──> Cloudflare edge ──tunnel──> cloudflared (office PC) ──> 127.0.0.1:8080
```

### 1. On the office machine

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                      # opens a browser; pick the domain
cloudflared tunnel create pacific-finance     # writes a credentials JSON
cloudflared tunnel route dns pacific-finance finance.pacific-surfaces.com
```

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: pacific-finance
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: finance.pacific-surfaces.com
    service: http://localhost:8080
  - service: http_status:404
```

Install it as a service so it survives a reboot:

```powershell
cloudflared service install
```

### 2. In Vercel

Project → Settings → Environment Variables, for **Production**:

| Variable | Value |
| --- | --- |
| `FINANCE_ENGINE_URL` | `https://finance.pacific-surfaces.com` |
| `FINANCE_ENGINE_KEY` | the same 43-character key the engine runs with |

Then **redeploy** — Vercel env changes do not reach running functions until the
next deployment.

### 3. Check

```powershell
curl.exe -s -o NUL -w "%{http_code}\n" https://finance.pacific-surfaces.com/api/v1/health
```

`503` is the right answer from outside: the engine is refusing an unkeyed
request, which proves the tunnel is up *and* the guard is intact. A `530` or a
timeout means the tunnel is down. Then open Bill Automation on the live site and
search the claimant box.

## What this commits you to

**The office machine becomes infrastructure.** For the live finance page to work,
that PC must be powered on with both the engine and `cloudflared` running. If it
sleeps, every user gets the unreachable banner. Disable sleep on it, or accept
that Bill Automation is available only during office hours.

**The API key becomes the only gate.** Once the hostname resolves publicly,
anyone who finds it can reach `/api/v1` — the 43-character key is what stops
them. That is a real secret and adequate, but for defence in depth add a
Cloudflare Access policy with a service token in front of the hostname; the ERP
proxy would then also need to send the `CF-Access-Client-Id` and
`CF-Access-Client-Secret` headers (a small change in
`src/app/api/office/finance/[...path]/route.ts`). Also keep
`app.ui_enabled: false`, so the tunnel exposes only the key-protected `/api/v1`
and never the engine's own loginless pages.

## The alternative: move the engine off the office PC

`tally.mode` is `"file"` today — the engine writes importable XML to
`data/tally_export` and posts nothing. Nothing about it currently requires
sitting next to Tally, so it could run on a small cloud VM instead, and the
office-PC dependency disappears entirely.

The trade: `MASTER.xml` has to be re-uploaded there whenever the chart of
accounts changes, the accountant downloads the export XML rather than finding it
on a local disk, and `finance.db` plus the scanned bills live off-premises. And
the day `tally.mode` moves to `"http"` — posting vouchers straight into Tally's
gateway — the engine has to be back on the office network anyway.

For now the tunnel is the smaller change and keeps the bills on your own
hardware.

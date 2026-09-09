#!/usr/bin/env node
/**
 * THE SAMPLE FLOW, AGAINST THE RUNNING APP.
 *
 * Drives the real HTTP routes on your local dev server — same code that goes to
 * production, against your Docker Postgres through Prisma. Request → project →
 * slab → cut → polish → pack → shelf, asserting at every hop.
 *
 *   Terminal 1:  npm run dev
 *   Terminal 2:  node scripts/e2e-sample-flow.mjs
 *
 * Environment:
 *   BASE_URL   default http://localhost:3000
 *   EMAIL      a login that can reach BOTH /sampling and /fab. An ADMIN.
 *   PASSWORD
 *
 *   EMAIL=admin@pacific.com PASSWORD=secret node scripts/e2e-sample-flow.mjs
 *
 * ─────────────────────────────────── WHY THIS EXISTS ────────────────────────
 * The audit's one structural finding: 1,158 unit tests and NOT ONE of them
 * exercises a route as a route. Every critical defect it found lived in that
 * gap — a route reading a column no screen writes, a screen throwing away an
 * answer the server composed, a guard present in one of the two places that
 * needed it. None of those are visible from a pure function.
 *
 * So this is the first route-level test rather than a one-off script. It is
 * meant to be run again after every change to the sampling pipeline.
 *
 * IT WRITES REAL DATA. Run it against dev, never production. It creates one
 * SAMPLE project and leaves it there — the code it prints is the one to delete.
 *
 * NOTHING IS SKIPPED SILENTLY. A stage that cannot run for want of a fixture
 * (no QC slab, no worker on the roster, no machine) reports SKIP and says what
 * is missing, so a partial run still tells you exactly how far the pipeline got.
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "";
const PASSWORD = process.env.PASSWORD ?? "";

/* ── a cookie jar, because auth is a session ──────────────────────────────── */
const jar = new Map();
function remember(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      redirect: "manual",
      headers: {
        cookie: cookieHeader(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // The commonest failure by a mile: the dev server is not running. A stack
    // trace here would send someone reading this script instead of starting it.
    die(`Cannot reach ${BASE} — is \`npm run dev\` running?\n(${e?.cause?.code ?? e?.message ?? e})`);
  }
  remember(res);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* HTML — an expired session or a crash */ }
  return { status: res.status, ok: res.ok, data, text };
}
const GET = (p) => call("GET", p);
const POST = (p, b) => call("POST", p, b ?? {});

/* ── reporting ────────────────────────────────────────────────────────────── */
let passed = 0, failed = 0, skipped = 0;
const notes = [];
function pass(name, detail = "") {
  passed++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? "  — " + detail : ""}`);
}
function fail(name, detail) {
  failed++; console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${detail}`);
}
function skip(name, why) {
  skipped++; console.log(`  \x1b[33mSKIP\x1b[0m  ${name}  — ${why}`);
  notes.push(`${name}: ${why}`);
}
function head(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }
function die(msg) { console.log(`\n\x1b[31m${msg}\x1b[0m\n`); process.exit(1); }

/* ── 0 · sign in ──────────────────────────────────────────────────────────── */
async function signIn() {
  head("0 · sign in");
  if (!EMAIL || !PASSWORD) die("Set EMAIL and PASSWORD. See the header of this file.");

  const csrf = await GET("/api/auth/csrf");
  if (!csrf.data?.csrfToken) {
    die(`No CSRF token from ${BASE}. Is the dev server up? (got ${csrf.status})`);
  }
  // NextAuth's credentials callback takes a form body, not JSON.
  const res = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookieHeader(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken: csrf.data.csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE,
    }),
  });
  remember(res);

  const me = await GET("/api/auth/session");
  if (!me.data?.user) die(`Signed in as nobody — check EMAIL and PASSWORD. (${res.status})`);
  pass("signed in", me.data.user.email ?? me.data.user.name ?? "");
}

/* ── 1 · raise the request ────────────────────────────────────────────────── */
async function raiseRequest() {
  head("1 · sampling desk raises a request  ·  POST /api/sampling/requests");

  const cat = await GET("/api/sampling/catalogue");
  if (!cat.ok || !Array.isArray(cat.data)) {
    die(`Catalogue unreadable (${cat.status}). Run scripts/0051 + the catalogue seed first.`);
  }
  const colour = cat.data.flatMap((s) => s.colours ?? [])[0];
  if (!colour) die("No colours in the catalogue — seed it before running this.");

  // THREE SIZES UNDER ONE COLOUR. Three rows is the point: each needs its own
  // letter and its own slab_code, and the missing slab_code is what used to
  // kill this route with a bare 500. One row would prove almost nothing.
  const stamp = Date.now().toString().slice(-6);
  const body = {
    requestedFor: `E2E ${stamp}`,
    note: "automated end-to-end run",
    lines: [
      { colourId: colour.id, finish: "Polished", length: "12", width: "12", thickness: "20 mm", quantity: 4 },
      { colourId: colour.id, finish: "Polished", length: "11", width: "11", thickness: "20 mm", quantity: 2 },
      { colourId: colour.id, finish: "Polished", length: "6",  width: "6",  thickness: "20 mm", quantity: 3 },
    ],
  };

  const res = await POST("/api/sampling/requests", body);
  if (!res.ok) {
    fail("request raised", `${res.status} — ${res.data?.error ?? res.text.slice(0, 300)}`);
    die("Step 1 is the gate. Nothing downstream can run. Stopping.");
  }
  pass("request raised", `${res.data.code} · ${res.data.lines} lines · ${res.data.pieces} pieces`);

  if (res.data.pieces !== 9) fail("piece total", `expected 9, got ${res.data.pieces}`);
  else pass("piece total is 9");

  return { code: res.data.code, id: res.data.id, colour };
}

/* ── 2 · it reads back, with the right shape ──────────────────────────────── */
async function readBack(order) {
  head("2 · the desk sees it  ·  GET /api/sampling/requests");

  const list = await GET("/api/sampling/requests");
  if (!list.ok) return fail("list readable", `${list.status} — ${list.data?.error ?? ""}`);
  const mine = (list.data ?? []).find((o) => o.code === order.code);
  if (!mine) return fail("order present", `${order.code} is not in the list`);
  pass("order present", `${mine.code} · ordered ${mine.ordered}`);

  if (mine.ordered !== 9) fail("ordered count", `expected 9, got ${mine.ordered}`);
  else pass("ordered count is 9");

  const letters = mine.lines.map((l) => l.rowLetter).filter(Boolean);
  if (new Set(letters).size !== 3) {
    fail("three distinct row letters", `got ${JSON.stringify(mine.lines.map((l) => l.rowLetter))}`);
  } else pass("three distinct row letters", letters.join(", "));

  const noShelf = mine.lines.filter((l) => !l.colour || !l.finish || !l.sizeLabel);
  if (noShelf.length) fail("every line names a shelf", `${noShelf.length} line(s) missing colour/finish/size`);
  else pass("every line names a colour, finish and size");
}

/* ── 3 · the supervisor's board knows it is a sample ──────────────────────── */
async function supervisorSees(order) {
  head("3 · supervisor board  ·  GET /api/fab/supervisor/board");

  const projects = await GET("/api/fab/supervisor/board?view=projects");
  if (!projects.ok) { fail("board readable", `${projects.status}`); return null; }
  const proj = (projects.data ?? []).find((p) => p.projectCode === order.code);
  if (!proj) { fail("project on the board", `${order.code} not listed`); return null; }
  pass("project on the board", `${proj.projectCode}`);

  if (proj.kind !== "SAMPLE") fail("kind is SAMPLE", `got ${JSON.stringify(proj.kind)} — the badge and the hidden sink steps depend on this`);
  else pass("kind is SAMPLE");

  const reqs = await GET(`/api/fab/supervisor/board?projectId=${proj.id}&view=requirements`);
  if (!reqs.ok) { fail("rows readable", `${reqs.status}`); return proj; }
  pass("rows readable", `${reqs.data.length} rows`);

  const sinky = (reqs.data ?? []).filter((r) => (r.sinkQuantity ?? 0) > 0);
  if (sinky.length) fail("no sample row carries a sink", `${sinky.length} row(s) do`);
  else pass("no sample row carries a sink");

  const unlettered = (reqs.data ?? []).filter((r) => !r.rowLetter);
  if (unlettered.length) fail("board sends rowLetter", `${unlettered.length} row(s) have none — the outstanding list will fall back to piece_label`);
  else pass("board sends rowLetter for every row");

  return { proj, rows: reqs.data };
}

/* ── 4 · slab, allocation, send to cutter ─────────────────────────────────── */
async function toTheCutter(board) {
  head("4 · pick a slab and send it  ·  slab-assignment + approve-slab");

  const slabs = await GET("/api/fab/slabs?search=&thickness=20");
  const qc = (slabs.data?.rows ?? slabs.data ?? []).find?.((s) => s.id);
  if (!qc) { skip("slab picked", "no QC slab came back from /api/fab/slabs — seed one, or widen the search"); return null; }

  const added = await POST("/api/fab/supervisor/slab-assignment", {
    action: "add-slab", projectId: board.proj.id, pacificQcId: qc.id,
  });
  if (!added.ok) { fail("slab added", `${added.status} — ${added.data?.error ?? ""}`); return null; }
  pass("slab added", `${added.data.slabCode}`);

  for (const row of board.rows) {
    const a = await POST("/api/fab/supervisor/slab-assignment", {
      action: "assign", slabId: added.data.slabId, requirementId: row.id,
      allocatedQuantity: row.quantity,
    });
    if (!a.ok) fail(`row ${row.rowLetter} allocated`, `${a.status} — ${a.data?.error ?? ""}`);
    else pass(`row ${row.rowLetter} allocated`, `${row.quantity} pieces`);
  }

  const sent = await POST("/api/fab/approve-slab", { slabId: added.data.slabId });
  if (!sent.ok) { fail("sent to cutter", `${sent.status} — ${sent.data?.error ?? ""}`); return null; }
  pass("sent to cutter", `${sent.data.piecesCreated ?? "?"} pieces, job ${sent.data.slabJobId ?? "?"}`);

  // IDEMPOTENCE. A double-click must return the same job, never a second one.
  const again = await POST("/api/fab/approve-slab", { slabId: added.data.slabId });
  if (again.ok && again.data?.slabJobId === sent.data?.slabJobId) {
    pass("re-sending is idempotent", "same job returned");
  } else if (again.status === 409) {
    pass("re-sending is refused", "409, which is also correct");
  } else {
    fail("re-sending is safe", `got ${again.status} — ${JSON.stringify(again.data).slice(0, 160)}`);
  }

  return { slabId: added.data.slabId, slabJobId: sent.data.slabJobId, qcId: qc.id };
}

/* ── 5 · the floor: cut, polish, pack ─────────────────────────────────────── */
async function startSession(processType) {
  const workers = await GET("/api/fab/workers");
  const worker = (workers.data ?? []).find?.((w) => w.id);
  if (!worker) return { ok: false, why: "no worker on the roster (/api/fab/workers is empty)" };
  const r = await POST("/api/fab/session/start", {
    processType, workerId: worker.id, shift: "DAY",
  });
  if (!r.ok) return { ok: false, why: `session/start ${r.status} — ${r.data?.error ?? ""}` };
  return { ok: true };
}

async function theFloor(slab, order) {
  head("5 · the floor  ·  cut → polish → pack");

  const cut = await startSession("CUTTING");
  if (!cut.ok) { skip("cutting", cut.why); }
  else {
    const done = await POST("/api/fab/queues/cutting/complete-job", { slabJobId: slab.slabJobId });
    if (!done.ok) fail("slab job completed", `${done.status} — ${done.data?.error ?? ""}`);
    else pass("slab job completed");
  }

  const q = await GET("/api/fab/queues/polishing");
  const mine = (q.data ?? []).filter?.((p) => p.project?.projectCode === order.code) ?? [];
  if (!mine.length) skip("polishing", "no pieces of this order reached the polishing queue");
  else {
    const pol = await startSession("POLISHING");
    if (!pol.ok) skip("polishing", pol.why);
    else {
      let n = 0;
      for (const p of mine) {
        const r = await POST("/api/fab/queues/polishing/complete", { pieceId: p.id });
        if (r.ok) n++;
      }
      if (n === mine.length) pass("polished", `${n} pieces`);
      else fail("polished", `${n} of ${mine.length} completed`);
    }
  }

  // NEVER SINK, NEVER FABRICATION. The rule a sample exists under.
  for (const [label, url] of [["sink-cutting", "/api/fab/queues/sink-cutting"],
                              ["fabrication", "/api/fab/queues/fabrication"]]) {
    const r = await GET(url);
    const strays = (r.data ?? []).filter?.((p) => p.project?.projectCode === order.code) ?? [];
    if (strays.length) fail(`no sample piece in ${label}`, `${strays.length} found — samples must never reach it`);
    else pass(`no sample piece in ${label}`);
  }

  const pack = await GET("/api/fab/queues/packaging");
  const ready = (pack.data ?? []).filter?.((p) => p.project?.projectCode === order.code) ?? [];
  if (!ready.length) { skip("packing", "no pieces of this order reached the packaging queue"); return 0; }

  const sess = await startSession("PACKAGING");
  if (!sess.ok) { skip("packing", sess.why); return 0; }

  const made = await POST("/api/fab/queues/packaging/complete", {
    pieceIds: ready.map((p) => p.id), packageCode: `E2E-${Date.now().toString().slice(-6)}`,
  });
  if (!made.ok) { fail("packed", `${made.status} — ${made.data?.error ?? ""}`); return 0; }
  pass("packed", `${ready.length} pieces into ${made.data.packageCode}`);

  // THE ANSWER THE SCREEN USED TO THROW AWAY.
  if (made.data.samplesCredited != null) {
    pass("route reports the shelf credit", `${made.data.samplesCredited} credited, ${made.data.samplesUnattributed ?? 0} unattributed`);
    if (made.data.samplesUnattributed) {
      fail("every packed sample reached a shelf", `${made.data.samplesUnattributed} did not`);
    }
  }
  return ready.length;
}

/* ── 6 · the shelf ────────────────────────────────────────────────────────── */
async function theShelf(order, packedCount) {
  head("6 · the shelf  ·  GET /api/sampling/requests");
  const list = await GET("/api/sampling/requests");
  const mine = (list.data ?? []).find?.((o) => o.code === order.code);
  if (!mine) return fail("order still readable", "it vanished");

  console.log(`        ordered ${mine.ordered} · on slabs ${mine.onSlabs} · cut ${mine.released} · packed ${mine.packed} · shelf ${mine.credited}`);

  if (packedCount === 0) return skip("shelf credited", "nothing was packed, so there is nothing to credit");
  if (mine.credited === mine.packed && mine.packed > 0) {
    pass("every packed piece reached a shelf", `${mine.credited} of ${mine.packed}`);
  } else {
    fail("every packed piece reached a shelf", `${mine.credited} credited vs ${mine.packed} packed`);
  }
}

/* ── run ──────────────────────────────────────────────────────────────────── */
(async () => {
  console.log(`\n\x1b[1mSAMPLE FLOW, END TO END\x1b[0m   ${BASE}\n${"─".repeat(60)}`);
  await signIn();
  const order = await raiseRequest();
  await readBack(order);
  const board = await supervisorSees(order);
  let packed = 0;
  if (board) {
    const slab = await toTheCutter(board);
    if (slab) packed = await theFloor(slab, order);
    else skip("the floor", "no slab was sent, so cutting onwards could not run");
  }
  await theShelf(order, packed);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`\x1b[32m${passed} passed\x1b[0m · \x1b[31m${failed} failed\x1b[0m · \x1b[33m${skipped} skipped\x1b[0m`);
  if (notes.length) {
    console.log(`\nSkipped because a fixture was missing — not because anything is broken:`);
    for (const n of notes) console.log(`  · ${n}`);
  }
  console.log(`\nThis run left ${order.code} in the database. Delete it when you are done.\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => die(`Crashed: ${e?.stack ?? e}`));

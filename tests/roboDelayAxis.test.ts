import test from "node:test";
import assert from "node:assert/strict";

import { niceDelayScale } from "../src/lib/robo/delayAxis.ts";

/* The Delay Analysis bar chart's x-axis: a round max with even ticks and a
   little headroom so the longest bar's end label clears its bar. */

test("the reference case: 2003 → 0..2500 in five clean steps", () => {
  const { axisMax, ticks } = niceDelayScale(2003);
  assert.equal(axisMax, 2500);
  assert.deepEqual(ticks, [0, 500, 1000, 1500, 2000, 2500]);
});

test("a max that lands exactly on a tick is lifted one step for headroom", () => {
  // 2000 would put the longest bar flush at 100% with nowhere for its label.
  const { axisMax } = niceDelayScale(2000);
  assert.ok(axisMax > 2000);
  assert.equal(axisMax, 2500);
});

test("ticks start at 0, rise by a constant step, and end at axisMax", () => {
  const { axisMax, ticks } = niceDelayScale(437);
  assert.equal(ticks[0], 0);
  assert.equal(ticks[ticks.length - 1], axisMax);
  const step = ticks[1] - ticks[0];
  for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i] - ticks[i - 1], step);
});

test("small values still get a sane axis", () => {
  const { axisMax, ticks } = niceDelayScale(10);
  assert.ok(axisMax >= 10);
  assert.equal(ticks[0], 0);
  assert.ok(ticks.length >= 2);
});

test("no delays at all is a 0..1 axis, never NaN or a divide-by-zero", () => {
  assert.deepEqual(niceDelayScale(0), { axisMax: 1, ticks: [0, 1] });
  assert.deepEqual(niceDelayScale(-5), { axisMax: 1, ticks: [0, 1] });
  assert.deepEqual(niceDelayScale(NaN), { axisMax: 1, ticks: [0, 1] });
});

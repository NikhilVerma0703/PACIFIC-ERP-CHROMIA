import test from "node:test";
import assert from "node:assert/strict";

import { hourlyYAxis } from "../src/lib/robo/hourlyAxis.ts";

/* Default 0…12 in steps of 2; extend by 2 only when an hour exceeds 12. */

test("a quiet run keeps the default 0,2,4,6,8,10,12", () => {
  assert.deepEqual(hourlyYAxis(5).ticks, [0, 2, 4, 6, 8, 10, 12]);
  assert.equal(hourlyYAxis(5).max, 12);
  assert.deepEqual(hourlyYAxis(12).ticks, [0, 2, 4, 6, 8, 10, 12]); // exactly 12 stays 12
});

test("no data still shows the default axis, not an empty one", () => {
  assert.equal(hourlyYAxis(0).max, 12);
  assert.deepEqual(hourlyYAxis(0).ticks, [0, 2, 4, 6, 8, 10, 12]);
});

test("more than 12 extends the axis in steps of 2, only as far as needed", () => {
  assert.equal(hourlyYAxis(13).max, 14);
  assert.deepEqual(hourlyYAxis(13).ticks, [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.equal(hourlyYAxis(14).max, 14);
  assert.equal(hourlyYAxis(21).max, 22);
  assert.deepEqual(hourlyYAxis(21).ticks, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
});

test("ticks always start at 0, step by 2, and end exactly at max", () => {
  for (const n of [0, 3, 12, 13, 27, 40]) {
    const { max, ticks } = hourlyYAxis(n);
    assert.equal(ticks[0], 0);
    assert.equal(ticks[ticks.length - 1], max);
    for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i] - ticks[i - 1], 2);
    assert.equal(max % 2, 0);
    assert.ok(max >= 12);
  }
});

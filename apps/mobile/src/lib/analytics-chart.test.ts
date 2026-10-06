import { expect, test } from "bun:test";
import { trendBars } from "./analytics-chart";

test("follower losses extend below zero while gains extend above it", () => {
  const chart = trendBars([-10, 10, 0], 300, 100);
  expect(chart.baseline).toBe(50);
  expect(chart.bars).toEqual([
    { x: 0, y: 50, width: 98, height: 50 },
    { x: 100, y: 0, width: 98, height: 50 },
    { x: 200, y: 50, width: 98, height: 0 },
  ]);
});

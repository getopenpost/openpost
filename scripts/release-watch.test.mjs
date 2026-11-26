import { expect, test } from "bun:test";

import { releaseWatchSettlement } from "./release-watch.mjs";

const options = {
  completion: ["Publish complete deployed release", "Record release in CHANGELOG"],
  background: new Set(["Publish and verify n8n package", "Publish and verify npm CLI package"]),
  optional: new Set(["Verify live CLI install from the published release"]),
};
const job = (name, status, conclusion = null) => ({ name, status, conclusion });
const published = [
  job("Deploy production", "completed", "success"),
  job("Publish complete deployed release", "completed", "success"),
  job("Record release in CHANGELOG", "completed", "success"),
];

test("a published release settles while independent package publications still run", () => {
  const n8n = job("Publish and verify n8n package", "in_progress");
  const live = job("Verify live CLI install from the published release", "queued");
  expect(releaseWatchSettlement([...published, n8n, live], options)).toEqual({
    settled: true,
    inFlight: [n8n],
  });
});

test("an unfinished required job or completion job keeps the watch open", () => {
  const discord = job("Announce release in Discord", "in_progress");
  expect(releaseWatchSettlement([...published, discord], options).settled).toBe(false);
  const pendingRecord = [
    published[0],
    published[1],
    job("Record release in CHANGELOG", "in_progress"),
    job("Publish and verify n8n package", "completed", "success"),
  ];
  expect(releaseWatchSettlement(pendingRecord, options).settled).toBe(false);
  const failedRecord = [published[0], published[1], job(published[2].name, "completed", "failure")];
  expect(releaseWatchSettlement(failedRecord, options).settled).toBe(false);
});

test("without completion jobs a run settles only through its own conclusion", () => {
  expect(releaseWatchSettlement(published, { ...options, completion: [] }).settled).toBe(false);
});

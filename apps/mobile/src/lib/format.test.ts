import { afterEach, expect, test } from "bun:test";

import { accountHandle, platformLabel, relativeTime } from "./format";

const relativeTimeFormat = Intl.RelativeTimeFormat;

afterEach(() => {
  Object.defineProperty(Intl, "RelativeTimeFormat", {
    configurable: true,
    value: relativeTimeFormat,
  });
});

test("formats publication times when Hermes does not provide RelativeTimeFormat", () => {
  Object.defineProperty(Intl, "RelativeTimeFormat", {
    configurable: true,
    value: undefined,
  });
  const now = Date.now();
  const originalNow = Date.now;
  Date.now = () => now;

  try {
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5 minutes ago");
  } finally {
    Date.now = originalNow;
  }
});

test("formats account handles with exactly one at sign", () => {
  expect(accountHandle("@rodrgds", "youtube-rodrgds")).toBe("@rodrgds");
  expect(accountHandle("rodrgds", "youtube-rodrgds")).toBe("@rodrgds");
  expect(accountHandle("", "youtube-rodrgds")).toBe("youtube-rodrgds");
});

test("labels fediverse platforms by name", () => {
  expect(platformLabel("pixelfed")).toBe("Pixelfed");
  expect(platformLabel("peertube")).toBe("PeerTube");
  expect(platformLabel("lemmy")).toBe("Lemmy");
  expect(platformLabel("piefed")).toBe("PieFed");
});

test("connection labels preserve display names and instance-qualified platform names", () => {
  expect(accountHandle("Rodrigo Dias", "facebook", "facebook")).toBe("Rodrigo Dias");
  expect(accountHandle("Rodrigo", "linkedin", "linkedin")).toBe("Rodrigo");
  expect(accountHandle("rodrgds", "threads", "threads")).toBe("@rodrgds");
  expect(accountHandle("Studio", "YouTube", "youtube")).toBe("Studio");
  expect(accountHandle("@studio", "YouTube", "youtube")).toBe("@studio");
  expect(platformLabel("mastodon:https://masto.pt")).toBe("Mastodon");
});

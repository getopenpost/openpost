import { afterEach, describe, expect, test } from "bun:test";

import {
  accountHandle,
  calendarOccurrence,
  platformColor,
  platformKey,
  platformLabel,
  relativeTime,
} from "./format";

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
  expect(accountHandle("@rodrgds", "youtube-rodrgds", "threads")).toBe("@rodrgds");
  expect(accountHandle("rodrgds", "youtube-rodrgds", "threads")).toBe("@rodrgds");
  expect(accountHandle("", "youtube-rodrgds", "threads")).toBe("youtube-rodrgds");
});

test("platform keys resolve aliases, padding, and instance suffixes", () => {
  expect(platformKey("twitter")).toBe("x");
  expect(platformKey(" twitter ")).toBe("x");
  expect(platformKey("Twitter:instance")).toBe("x");
  expect(platformKey("x:instance")).toBe("x");
  expect(platformKey(" GMB ")).toBe("googlebusiness");
  expect(platformKey("gmb")).toBe("googlebusiness");
  expect(platformKey("Mastodon:https://masto.pt")).toBe("mastodon");
});

test("labels tolerate padding around the platform", () => {
  expect(platformLabel(" mastodon ")).toBe("Mastodon");
  expect(platformLabel(" Twitter:instance ")).toBe("X");
});

test("unknown keys pass through without resolving prototype properties", () => {
  expect(platformKey("constructor")).toBe("constructor");
  expect(platformColor("constructor")).toBe("#6b7280");
});

test("padded handle-first platforms keep @", () => {
  expect(accountHandle("acme", "fallback", " twitter ")).toBe("@acme");
});

test("pinterest and google business handles render without @", () => {
  expect(accountHandle("acme", "fallback", "pinterest")).toBe("acme");
  expect(accountHandle("acme", "fallback", "googlebusiness")).toBe("acme");
  expect(accountHandle("acme", "fallback", "gmb")).toBe("acme");
});

test("connection labels preserve display names and instance-qualified platform names", () => {
  expect(accountHandle("Rodrigo Dias", "facebook", "facebook")).toBe("Rodrigo Dias");
  expect(accountHandle("Rodrigo", "linkedin", "linkedin")).toBe("Rodrigo");
  expect(accountHandle("rodrgds", "threads", "threads")).toBe("@rodrgds");
  expect(accountHandle("Studio", "YouTube", "youtube")).toBe("Studio");
  expect(accountHandle("@studio", "YouTube", "youtube")).toBe("@studio");
  expect(platformLabel("mastodon:https://masto.pt")).toBe("Mastodon");
});

describe("calendarOccurrence", () => {
  // Same status-to-field rule as the web owner `publicationCalendarOccurrence`:
  // scheduled/publishing use the authored schedule, published prefers the
  // recorded run, every other status has no occurrence.
  const cases: {
    status: string;
    pub: Parameters<typeof calendarOccurrence>[0];
    expected: string | null;
  }[] = [
    {
      status: "draft",
      pub: { status: "draft", scheduled_at: "2026-10-18T10:00:00Z" },
      expected: null,
    },
    {
      status: "ready without a schedule",
      pub: { status: "ready" },
      expected: null,
    },
    {
      status: "ready with a schedule",
      pub: { status: "ready", scheduled_at: "2026-10-18T10:00:00Z" },
      expected: null,
    },
    {
      status: "scheduled",
      pub: {
        status: "scheduled",
        scheduled_at: "2026-10-18T10:00:00Z",
        actual_run_at: "2026-10-18T10:07:00Z",
      },
      expected: "2026-10-18T10:00:00.000Z",
    },
    {
      status: "publishing",
      pub: {
        status: "publishing",
        scheduled_at: "2026-10-18T10:00:00Z",
        actual_run_at: "2026-10-18T10:07:00Z",
      },
      expected: "2026-10-18T10:00:00.000Z",
    },
    {
      status: "published",
      pub: {
        status: "published",
        scheduled_at: "2026-10-18T10:00:00Z",
        actual_run_at: "2026-10-18T10:07:00Z",
      },
      expected: "2026-10-18T10:07:00.000Z",
    },
    {
      status: "published falling back to created_at",
      pub: { status: "published", created_at: "2026-10-18T08:00:00Z" },
      expected: "2026-10-18T08:00:00.000Z",
    },
    {
      status: "failed with a schedule",
      pub: { status: "failed", scheduled_at: "2026-10-18T10:00:00Z" },
      expected: null,
    },
  ];

  for (const { status, pub, expected } of cases) {
    test(`maps ${status}`, () => {
      expect(calendarOccurrence(pub)?.toISOString() ?? null).toBe(expected);
    });
  }
});

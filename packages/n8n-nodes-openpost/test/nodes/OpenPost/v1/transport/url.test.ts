import { describe, expect, test } from "bun:test";

import {
  normalizeOpenPostBaseUrl,
  openPostApiUrl,
} from "../../../../../nodes/OpenPost/v1/transport/url";

describe("OpenPost credential URL normalization", () => {
  test("accepts an origin and builds the API URL", () => {
    expect(normalizeOpenPostBaseUrl("https://openpost.example/")).toBe("https://openpost.example");
    expect(openPostApiUrl("https://openpost.example", "/workspaces")).toBe(
      "https://openpost.example/api/v1/workspaces",
    );
  });

  test("rejects API paths and missing protocols with clear errors", () => {
    expect(() => normalizeOpenPostBaseUrl("openpost.example")).toThrow(
      "must include http:// or https://",
    );
    expect(() => normalizeOpenPostBaseUrl("https://openpost.example/api/v1")).toThrow(
      "without /api or /api/v1",
    );
    expect(() => normalizeOpenPostBaseUrl("https://openpost.example/workspaces")).toThrow(
      "only the OpenPost origin",
    );
  });
});

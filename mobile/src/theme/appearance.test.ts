import { describe, expect, test } from "bun:test";

import { themeAvailabilityMessage, themeChoiceDescription } from "./appearance";

describe("appearance theme availability copy", () => {
  test("removes the loading message once a workspace contract is active", () => {
    expect(
      themeAvailabilityMessage(
        {
          kind: "fallback",
          reason: "contract-unavailable",
        },
        "light",
      ),
    ).toBe("Workshop is shown until this workspace theme is ready.");
    expect(
      themeAvailabilityMessage(
        {
          kind: "contract",
          identity: "studio@1",
          revision: "1",
          resolutionSource: "organization",
        },
        "light",
      ),
    ).toBe("Applied to this workspace.");
  });

  test("explains safe resource and server fallback states", () => {
    expect(
      themeAvailabilityMessage(
        {
          kind: "fallback",
          reason: "resources-unavailable",
        },
        "light",
      ),
    ).toBe("Workshop is shown while this theme finishes loading.");
    expect(
      themeAvailabilityMessage(
        {
          kind: "contract",
          identity: "workshop@fallback",
          revision: "1",
          resolutionSource: "fallback",
        },
        "light",
      ),
    ).toBe("Workshop replaced a workspace theme that could not be applied safely.");
  });

  test("explains complete Workshop fallback for a single-scheme theme", () => {
    expect(
      themeAvailabilityMessage({ kind: "fallback", reason: "unsupported-scheme" }, "light"),
    ).toBe("This theme does not include light mode, so Workshop is shown.");
  });
});

test("single-scheme themes stay selectable through their Workshop fallback", () => {
  expect(
    themeChoiceDescription(
      {
        key: "midnight",
        name: "Midnight",
        reference: { kind: "built_in", id: "midnight", version: 1 },
        supportedSchemes: ["dark"],
      },
      "light",
    ),
  ).toBe("Uses Workshop in light mode.");
});

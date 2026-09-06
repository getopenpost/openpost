const { describe, expect, test } = require("bun:test");

const { makeReleaseSigningOptional } = require("./with-android-release-signing");

describe("withAndroidReleaseSigning", () => {
  test("keeps local debug signing explicit and leaves CI release output unsigned", () => {
    const result = makeReleaseSigningOptional(
      `debug {\n  signingConfig signingConfigs.debug\n}\nrelease {\n  signingConfig signingConfigs.debug\n}`,
    );
    expect(result).toContain("findProperty('openpostDebugSigning')");
    expect(result.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(2);
    expect(result.indexOf("findProperty")).toBeGreaterThan(result.indexOf("release {"));
  });

  test("fails when the Expo template changes", () => {
    expect(() => makeReleaseSigningOptional("release { }")).toThrow("Expected one");
  });
});

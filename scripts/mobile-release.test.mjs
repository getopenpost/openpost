import assert from "node:assert/strict";
import test from "node:test";

import {
  createMobileReleaseManifest,
  readMobileIdentity,
  requireMonotonicMobileIdentity,
  validateMobileReleaseManifest,
} from "./mobile-release.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const apkSHA256 = `sha256:${"a".repeat(64)}`;

test("reads one intentional mobile identity from Expo and package metadata", () => {
  assert.deepEqual(
    readMobileIdentity(
      { expo: { version: "0.2.0", android: { versionCode: 2 } } },
      { version: "0.2.0" },
    ),
    { version_name: "0.2.0", version_code: 2 },
  );
  assert.throws(
    () =>
      readMobileIdentity(
        { expo: { version: "0.2.0", android: { versionCode: 2 } } },
        { version: "0.1.0" },
      ),
    /does not match/,
  );
});

test("requires both mobile version fields to advance past the released tag", () => {
  const previous = { version_name: "0.1.0", version_code: 1 };
  assert.doesNotThrow(() =>
    requireMonotonicMobileIdentity({ version_name: "0.2.0", version_code: 2 }, previous),
  );
  assert.throws(
    () => requireMonotonicMobileIdentity({ version_name: "0.2.0", version_code: 1 }, previous),
    /version code/,
  );
  assert.throws(
    () => requireMonotonicMobileIdentity({ version_name: "0.1.0", version_code: 2 }, previous),
    /mobile version/,
  );
});

test("binds Android identity, source revision, and APK digest", () => {
  const identity = { version_name: "0.2.0", version_code: 2 };
  const manifest = createMobileReleaseManifest({ identity, revision, apkSHA256 });
  assert.deepEqual(manifest, {
    schema_version: 1,
    version_name: "0.2.0",
    version_code: 2,
    revision,
    apk_sha256: apkSHA256,
  });
  assert.throws(
    () =>
      validateMobileReleaseManifest(manifest, {
        expectedIdentity: identity,
        expectedRevision: revision,
        expectedAPKDigest: `sha256:${"b".repeat(64)}`,
      }),
    /digest does not match/,
  );
});

test("rejects extra evidence fields and abbreviated revisions", () => {
  const identity = { version_name: "0.2.0", version_code: 2 };
  assert.throws(
    () =>
      validateMobileReleaseManifest({
        ...createMobileReleaseManifest({ identity, revision, apkSHA256 }),
        channel: "stable",
      }),
    /contain exactly/,
  );
  assert.throws(
    () => createMobileReleaseManifest({ identity, revision: "012345", apkSHA256 }),
    /full lowercase Git SHA/,
  );
});

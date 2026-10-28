import assert from "node:assert/strict";
import test from "node:test";

import {
  readMobileIdentity,
  requireCurrentMobileIdentity,
  requireMonotonicMobileIdentity,
  requireReleaseMobileIdentity,
} from "./mobile-release.mjs";

test("server-only releases keep the released mobile identity", () => {
  const released = { version_name: "0.2.0", version_code: 2 };
  requireReleaseMobileIdentity({ ...released }, released, false);
  assert.throws(
    () => requireReleaseMobileIdentity({ version_name: "0.2.1", version_code: 3 }, released, false),
    /must stay at the released identity/,
  );
  requireReleaseMobileIdentity({ version_name: "0.2.1", version_code: 3 }, released, true);
  assert.throws(
    () => requireReleaseMobileIdentity({ ...released }, released, true),
    /must be greater than released code/,
  );
});

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

test("accepts the released mobile identity until release preparation advances it", () => {
  const released = { version_name: "0.2.1", version_code: 3 };
  assert.doesNotThrow(() => requireCurrentMobileIdentity(released, released));
  assert.doesNotThrow(() =>
    requireCurrentMobileIdentity({ version_name: "0.2.2", version_code: 4 }, released),
  );
  assert.throws(
    () => requireCurrentMobileIdentity({ version_name: "0.2.1", version_code: 4 }, released),
    /advance together/,
  );
  assert.throws(
    () => requireCurrentMobileIdentity({ version_name: "0.2.0", version_code: 2 }, released),
    /older than released/,
  );
});

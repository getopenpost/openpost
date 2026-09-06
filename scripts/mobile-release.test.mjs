import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  nextMobileIdentity,
  prepareMobileReleaseFiles,
  readMobileIdentity,
  requireCurrentMobileIdentity,
  requireMonotonicMobileIdentity,
} from "./mobile-release.mjs";

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

test("prepares one automatic mobile identity for the next release", () => {
  const released = { version_name: "0.2.1", version_code: 3 };
  const prepared = nextMobileIdentity(released, released);
  assert.deepEqual(prepared, {
    version_name: "0.2.2",
    version_code: 4,
  });
  assert.deepEqual(nextMobileIdentity(prepared, released), prepared);
  assert.deepEqual(nextMobileIdentity({ version_name: "1.0.0", version_code: 10 }, released), {
    version_name: "1.0.0",
    version_code: 10,
  });
});

test("release preparation updates Expo and package identities together", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "openpost-mobile-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "app.json");
  const packagePath = path.join(directory, "package.json");
  const previousConfig = { expo: { version: "0.2.1", android: { versionCode: 3 } } };
  await Promise.all([
    writeFile(configPath, `${JSON.stringify(previousConfig, null, 2)}\n`),
    writeFile(packagePath, `${JSON.stringify({ name: "mobile", version: "0.2.1" }, null, 2)}\n`),
  ]);

  const identity = await prepareMobileReleaseFiles({
    configPath,
    packagePath,
    previousConfig,
  });

  assert.deepEqual(identity, { version_name: "0.2.2", version_code: 4 });
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    expo: { version: "0.2.2", android: { versionCode: 4 } },
  });
  assert.equal(JSON.parse(await readFile(packagePath, "utf8")).version, "0.2.2");
});

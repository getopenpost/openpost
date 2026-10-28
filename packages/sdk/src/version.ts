// SDK_VERSION mirrors the package.json version. The client User-Agent assertion
// in client.test.ts fails when they drift, so a release never ships a stale one.
export const SDK_VERSION = "0.5.1";

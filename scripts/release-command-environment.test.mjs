import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseCommandEnvironment,
  releaseGitHubRepository,
} from "./release-command-environment.mjs";

test("release commands stay bound to the canonical repository", () => {
  const environment = releaseCommandEnvironment(
    { PATH: "/bin", GH_REPO: "someone/other-repository" },
    { RELEASE_TOKEN: "available", GH_REPO: "another/other-repository" },
  );

  assert.equal(environment.GH_REPO, releaseGitHubRepository);
  assert.equal(environment.PATH, "/bin");
  assert.equal(environment.RELEASE_TOKEN, "available");
});

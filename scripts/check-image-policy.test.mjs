import assert from "node:assert/strict";
import test from "node:test";

import { imagePolicyInputs, validateImagePolicy } from "./check-image-policy.mjs";

test("the maintained image policy is internally consistent", () => {
  assert.deepEqual(validateImagePolicy(imagePolicyInputs(), new Date("2026-08-09T00:00:00Z")), []);
});

test("probe and architecture drift fail the policy check", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile
        .replace("/api/v1/health", "/api/v1/ready")
        .replace("received ${TARGETARCH:-unknown}", "unsupported target"),
      compose: inputs.compose.replace("platform: linux/amd64\n", ""),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("health check")));
  assert.ok(problems.some((problem) => problem.includes("target architecture")));
  assert.ok(problems.some((problem) => problem.includes("Compose")));
});

test("production build stages cannot drift back to mutable tags", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile.replace(/(@sha256:[a-f0-9]{64})(?= AS backend-builder)/u, ""),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("backend-builder")));
});

test("declared Go and Bun toolchains cannot drift between release surfaces", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      backendGoMod: inputs.backendGoMod.replace("go 1.26.6", "go 1.26.7"),
      mobilePackage: { ...inputs.mobilePackage, packageManager: "bun@1.3.12" },
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("Go module versions")));
  assert.ok(problems.some((problem) => problem.includes("Bun versions")));
});

test("runtime packages must stay declared and the pinned base cannot be upgraded", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile
        .replace("RUN apk add --no-cache", "RUN apk upgrade --no-cache && apk add --no-cache")
        .replace("ca-certificates ffmpeg tzdata sqlite", "ca-certificates tzdata sqlite"),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("runtime packages")));
  assert.ok(problems.some((problem) => problem.includes("apk upgrade")));
});

test("every installed runtime package must be present in the declared policy", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile.replace(
        "'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'",
        "'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0' curl",
      ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("runtime packages")));
});

test("the production image cannot rebuild a second frontend artifact", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile.replace(
        "FROM frontend_artifact AS frontend-builder",
        "FROM node:latest AS frontend-builder\nRUN bun run --filter @openpost/web build",
      ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("canonical frontend artifact")));
  assert.ok(problems.some((problem) => problem.includes("without rebuilding")));
});

test("smoke and release proof fail when OCI health or public readiness is omitted", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      smoke: inputs.smoke.replace(".State.Health.Status", ".State.Status"),
      release: inputs.release.replace("/api/v1/ready", "/api/v1/health"),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("OCI health")));
  assert.ok(problems.some((problem) => problem.includes("public database readiness")));
});

test("expired runtime support fails closed", () => {
  const inputs = imagePolicyInputs();
  assert.ok(
    validateImagePolicy(inputs, new Date("2028-06-01T00:00:00Z")).some((problem) =>
      problem.includes("support_ends"),
    ),
  );
});

test("candidate publication cannot move ahead of the blocking scan", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      ci: inputs.ci.replace(
        "Publish the validated candidate and record its digest",
        "Publish candidate without assurance ordering",
      ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("before registry publication")));
});

test("each scan step and the only image push are checked in their own scope", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      ci: inputs.ci
        .replace("severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL", "severity: CRITICAL,HIGH")
        .replace(
          "          docker buildx build --load",
          '          docker push "$image"\n          docker buildx build --load',
        ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("report severities")));
  assert.ok(problems.some((problem) => problem.includes("publish only")));
});

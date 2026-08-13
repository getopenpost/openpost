import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function workflowJobSteps(workflow, jobName) {
  const escapedName = jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const startMatch = new RegExp(`^  ${escapedName}:\\s*$`, "mu").exec(workflow);
  if (!startMatch) return [];
  const start = startMatch.index;
  const remainder = workflow.slice(start + startMatch[0].length);
  const nextJob = /^  [a-zA-Z0-9_-]+:\s*$/mu.exec(remainder);
  const job = workflow.slice(
    start,
    nextJob ? start + startMatch[0].length + nextJob.index : workflow.length,
  );
  const starts = [...job.matchAll(/^      - (?=(?:name|uses):)/gmu)].map(
    (match) => match.index,
  );
  return starts.map((stepStart, index) =>
    job.slice(stepStart, starts[index + 1] ?? job.length),
  );
}

function namedWorkflowStep(steps, name) {
  return steps.find((step) => step.includes(`- name: ${name}\n`));
}

const requiredEvidenceFiles = [
  "release-manifest.json",
  "openpost-image-evidence.json",
  "openpost-image.spdx.json",
  "openpost-image-trivy.json",
];

export function imagePolicyInputs(root = repositoryRoot) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  return {
    policy: JSON.parse(read("docker/image-policy.json")),
    dockerfile: read("docker/Dockerfile"),
    compose: read("docker-compose.yml"),
    ci: read(".github/workflows/ci.yml"),
    release: read(".github/workflows/release.yml"),
    dependabot: read(".github/dependabot.yml"),
    evidence: read("scripts/image-evidence.mjs"),
    smoke: read("scripts/smoke-production-image.sh"),
    docs: [
      read("README.md"),
      read("docs-site/installation/docker-compose.md"),
      read("docs-site/installation/docker-run.md"),
      read("docs-site/operations/container-image.md"),
      read("docs-site/operations/health-checks.md"),
    ].join("\n"),
  };
}

export function validateImagePolicy(inputs, now = new Date()) {
  const problems = [];
  const { policy } = inputs;
  if (policy.schema_version !== 1) problems.push("schema_version must be 1");

  const platforms = policy.supported_platforms;
  if (!Array.isArray(platforms) || platforms.length !== 1) {
    problems.push("exactly one published image platform must be declared");
  }
  const platform = platforms?.[0];
  if (platform !== "linux/amd64") {
    problems.push("the current tested image decision must be linux/amd64");
  }

  const buildBases = policy.build_bases;
  if (!Array.isArray(buildBases) || buildBases.length !== 1) {
    problems.push("exactly one pinned production build base is required");
  } else {
    const expectedStages = new Set(["backend-builder"]);
    const expectedBasePrefixes = new Map([["backend-builder", "golang:"]]);
    for (const buildBase of buildBases) {
      if (!expectedStages.delete(buildBase.stage)) {
        problems.push(`unexpected or repeated build stage ${buildBase.stage}`);
      }
      if (
        !/^[a-z0-9./_-]+:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/u.test(
          buildBase.reference ?? "",
        )
      ) {
        problems.push(`${buildBase.stage} must use a tag and sha256 digest`);
      }
      if (
        !String(buildBase.reference ?? "").startsWith(
          expectedBasePrefixes.get(buildBase.stage) ?? "\u0000",
        )
      ) {
        problems.push(`${buildBase.stage} uses the wrong toolchain image`);
      }
      if (
        !inputs.dockerfile.includes(
          `FROM ${buildBase.reference} AS ${buildBase.stage}`,
        )
      ) {
        problems.push(
          `${buildBase.stage} Dockerfile base does not match policy`,
        );
      }
    }
    if (expectedStages.size > 0) {
      problems.push(
        `missing production build stages: ${[...expectedStages].join(", ")}`,
      );
    }
  }

  const base = policy.runtime_base ?? {};
  if (
    !/^alpine:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(base.reference ?? "")
  ) {
    problems.push(
      "runtime base must use an exact Alpine patch and sha256 digest",
    );
  }
  const supportEnds = new Date(`${base.support_ends}T00:00:00Z`);
  if (!Number.isFinite(supportEnds.getTime()) || supportEnds <= now) {
    problems.push("runtime base support_ends must be a future date");
  }
  if (base.lifecycle_url !== "https://www.alpinelinux.org/releases/") {
    problems.push(
      "runtime base lifecycle must point to Alpine's release policy",
    );
  }
  const branchFromReference = String(base.reference ?? "").match(
    /^alpine:(\d+\.\d+)\./,
  )?.[1];
  if (base.release_branch !== branchFromReference) {
    problems.push("runtime base release_branch must match the pinned patch");
  }
  const reviewedOn = new Date(`${base.reviewed_on}T00:00:00Z`);
  if (
    !Number.isFinite(reviewedOn.getTime()) ||
    reviewedOn > now ||
    reviewedOn >= supportEnds
  ) {
    problems.push(
      "runtime base reviewed_on must be current and precede support end",
    );
  }

  if (!inputs.dockerfile.includes(`FROM ${base.reference} AS runtime`)) {
    problems.push("Dockerfile runtime FROM does not match image-policy.json");
  }
  if (
    !inputs.dockerfile.includes("FROM frontend_artifact AS frontend-builder") ||
    !inputs.dockerfile.includes(
      "COPY --from=frontend-builder / ./backend/cmd/openpost/public",
    )
  ) {
    problems.push(
      "Dockerfile must embed the caller-supplied canonical frontend artifact",
    );
  }
  if (
    !inputs.ci.includes(
      "--build-context frontend_artifact=backend/cmd/openpost/public",
    ) ||
    inputs.dockerfile.includes("bun run --filter @openpost/web build")
  ) {
    problems.push(
      "candidate image must consume the CI-built frontend without rebuilding it",
    );
  }
  const digest = String(base.reference ?? "").split("@", 2)[1] ?? "";
  if (
    !inputs.dockerfile.includes(
      `org.opencontainers.image.base.digest=\"${digest}\"`,
    )
  ) {
    problems.push(
      "Dockerfile base digest label does not match the pinned runtime base",
    );
  }
  if (!inputs.dockerfile.includes(`received \${TARGETARCH:-unknown}`)) {
    problems.push(
      "Dockerfile must fail closed for an unsupported target architecture",
    );
  }

  const health = policy.probes?.container_health;
  const ready = policy.probes?.traffic_readiness;
  if (health !== "/api/v1/health" || ready !== "/api/v1/ready") {
    problems.push("probe policy must keep liveness and readiness distinct");
  }
  if (!inputs.dockerfile.includes(`localhost:8080${health}`)) {
    problems.push("the OCI health check must use the liveness endpoint");
  }
  if (!inputs.compose.includes(`localhost:8080${health}`)) {
    problems.push("the Compose health check must use the liveness endpoint");
  }
  for (const dependency of ["sqlite3", "ffprobe", "ffmpeg"]) {
    if (!inputs.smoke.includes(dependency)) {
      problems.push(`production image smoke does not exercise ${dependency}`);
    }
  }
  for (const endpoint of [health, ready]) {
    if (!inputs.smoke.includes(endpoint)) {
      problems.push(`production image smoke does not exercise ${endpoint}`);
    }
  }
  if (
    !inputs.smoke.includes(
      "health_status=\"$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}",
    ) ||
    !inputs.smoke.includes('health_status" == "healthy')
  ) {
    problems.push("production image smoke does not require OCI health");
  }

  if (!inputs.compose.includes(`platform: ${platform}`)) {
    problems.push(
      "root Compose manifest must state the supported image platform",
    );
  }
  if (!inputs.ci.includes('--platform "$platform"')) {
    problems.push("candidate CI must build the declared platform explicitly");
  }

  const assurance = policy.assurance ?? {};
  if (
    !/^aquasecurity\/trivy-action@[a-f0-9]{40}$/.test(
      assurance.scanner_action ?? "",
    )
  ) {
    problems.push("the image scanner action must be pinned to a full commit");
  }
  const imageSteps = workflowJobSteps(inputs.ci, "image");
  const sbomStep = namedWorkflowStep(
    imageSteps,
    "Generate the final-image SPDX SBOM",
  );
  const reportStep = namedWorkflowStep(
    imageSteps,
    "Record the full final-image vulnerability report",
  );
  const blockingStep = namedWorkflowStep(
    imageSteps,
    "Block fixable high-severity vulnerabilities",
  );
  const scanSteps = [sbomStep, reportStep, blockingStep];
  if (scanSteps.some((step) => !step)) {
    problems.push("candidate CI must keep all three named image scan steps");
  }
  for (const [label, step] of [
    ["SBOM", sbomStep],
    ["full report", reportStep],
    ["blocking", blockingStep],
  ]) {
    if (!step) continue;
    for (const required of [
      `uses: ${assurance.scanner_action}`,
      `version: ${assurance.scanner_version}`,
      "image-ref: ghcr.io/${{ github.repository }}:sha-${{ github.sha }}",
      "scan-type: image",
      "scanners: vuln",
    ]) {
      if (!step.includes(required)) {
        problems.push(`candidate CI ${label} step is missing ${required}`);
      }
    }
  }
  if (!sbomStep?.includes(`format: ${assurance.sbom_format}`)) {
    problems.push("candidate CI SBOM format does not match image-policy.json");
  }
  if (!sbomStep?.includes("output: openpost-image.spdx.json")) {
    problems.push("candidate CI SBOM step must write the retained SPDX file");
  }
  const severities = Array.isArray(assurance.blocking_severities)
    ? assurance.blocking_severities.join(",")
    : "";
  if (!severities || !blockingStep?.includes(`severity: ${severities}`)) {
    problems.push(
      "candidate CI blocking severities do not match image-policy.json",
    );
  }
  const reportSeverities = Array.isArray(assurance.report_severities)
    ? assurance.report_severities.join(",")
    : "";
  if (
    !reportSeverities ||
    !reportStep?.includes(`severity: ${reportSeverities}`)
  ) {
    problems.push(
      "candidate CI report severities do not match image-policy.json",
    );
  }
  if (
    !reportStep?.includes("format: json") ||
    !reportStep?.includes("output: openpost-image-trivy.json")
  ) {
    problems.push("candidate CI full report step must write the retained JSON");
  }
  if (
    assurance.blocking_ignore_unfixed !== true ||
    !blockingStep?.includes("ignore-unfixed: true") ||
    !blockingStep?.includes("exit-code: 1")
  ) {
    problems.push(
      "candidate CI must apply the documented unfixed-finding policy",
    );
  }
  if (!blockingStep?.includes("format: table")) {
    problems.push("candidate CI blocking scan must keep a readable log table");
  }
  const trivySteps = imageSteps.filter((step) =>
    step.includes("aquasecurity/trivy-action@"),
  );
  if (trivySteps.length !== 3) {
    problems.push("candidate CI must have exactly three Trivy image steps");
  }
  const stepIndex = (name) =>
    imageSteps.findIndex((step) => step.includes(`- name: ${name}\n`));
  const smokeIndex = imageSteps.findIndex((step) =>
    step.includes("scripts/smoke-production-image.sh"),
  );
  const validateIndex = stepIndex("Validate image assurance evidence");
  const diagnosticsIndex = stepIndex("Retain final-image diagnostic evidence");
  const blockingScanIndex = stepIndex(
    "Block fixable high-severity vulnerabilities",
  );
  const publishIndex = stepIndex(
    "Publish the validated candidate and record its digest",
  );
  if (
    smokeIndex < 0 ||
    validateIndex <= smokeIndex ||
    diagnosticsIndex <= validateIndex ||
    blockingScanIndex <= diagnosticsIndex ||
    publishIndex <= blockingScanIndex
  ) {
    problems.push(
      "candidate CI must smoke, validate and retain diagnostics, then block before registry publication",
    );
  }
  const pushSteps = imageSteps.filter((step) => /\bdocker push\b/u.test(step));
  const publishStep = namedWorkflowStep(
    imageSteps,
    "Publish the validated candidate and record its digest",
  );
  if (pushSteps.length !== 1 || pushSteps[0] !== publishStep) {
    problems.push(
      "candidate CI must publish only in the post-scan digest step",
    );
  }
  if (
    !reportStep?.includes("ignore-unfixed: false") ||
    !reportStep?.includes("exit-code: 0")
  ) {
    problems.push(
      "candidate CI must preserve a non-blocking full vulnerability report",
    );
  }
  for (const evidence of requiredEvidenceFiles) {
    if (!inputs.ci.includes(evidence)) {
      problems.push(`candidate CI does not upload ${evidence}`);
    }
    if (!inputs.release.includes(evidence)) {
      problems.push(`tagged release does not publish ${evidence}`);
    }
  }
  if (
    !inputs.ci.includes("image-evidence.mjs create") ||
    !inputs.release.includes("image-evidence.mjs verify") ||
    !inputs.evidence.includes("release_manifest_sha256") ||
    !inputs.evidence.includes("sbom_sha256") ||
    !inputs.evidence.includes("vulnerability_report_sha256") ||
    !inputs.release.includes("${repository}@${digest}")
  ) {
    problems.push(
      "tagged release must promote the digest bound to the exact candidate evidence",
    );
  }
  if (
    !inputs.release.includes("gh run download") ||
    !inputs.release.includes("gh release create")
  ) {
    problems.push(
      "tagged release must download and publish exact candidate evidence",
    );
  }
  if (
    !inputs.release.includes("/api/v1/ready") ||
    !inputs.release.includes('"$readiness" == ready') ||
    !inputs.release.includes('"$database" == ok')
  ) {
    problems.push("tagged release must verify public database readiness");
  }

  if (
    !/package-ecosystem: docker[\s\S]*directory: \/docker[\s\S]*interval: weekly/.test(
      inputs.dependabot,
    )
  ) {
    problems.push("Dependabot must review Docker base updates every week");
  }
  if (!inputs.docs.includes("linux/amd64")) {
    problems.push(
      "install documentation must state the published image architecture",
    );
  }
  if (!inputs.docs.includes("image-policy.json")) {
    problems.push(
      "operator documentation must identify the image policy source",
    );
  }
  for (const policyStatement of [
    "does not restart a running container solely",
    "Compose does not remove traffic when readiness fails by itself",
  ]) {
    if (!inputs.docs.includes(policyStatement)) {
      problems.push(`probe documentation is missing: ${policyStatement}`);
    }
  }

  return problems;
}

function main() {
  const problems = validateImagePolicy(imagePolicyInputs());
  if (problems.length > 0) {
    console.error(
      `Container image policy check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    "Container image base, architecture, probes, SBOM, scan, and release evidence match policy.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}

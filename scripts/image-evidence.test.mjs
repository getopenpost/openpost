import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createImageEvidence,
  readImageEvidence,
  verifyImageEvidence,
} from "./image-evidence.mjs";

const revision = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const repository = "ghcr.io/rodrgds/openpost";
const tag = `sha-${revision}`;

async function withFixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "openpost-evidence-"));
  const files = {
    evidenceFile: path.join(directory, "evidence.json"),
    releaseManifest: path.join(directory, "manifest.json"),
    sbom: path.join(directory, "sbom.json"),
    vulnerabilityReport: path.join(directory, "report.json"),
  };
  try {
    await Promise.all([
      writeFile(files.releaseManifest, '{"manifest":true}\n'),
      writeFile(files.sbom, '{"spdx":true}\n'),
      writeFile(files.vulnerabilityReport, '{"report":true}\n'),
    ]);
    await run(files);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("binds a candidate digest to the exact manifest, SBOM, and report", () =>
  withFixture(async (files) => {
    const evidence = await createImageEvidence({
      repository,
      tag,
      revision,
      digest,
      ...files,
    });
    await writeFile(files.evidenceFile, JSON.stringify(evidence));

    assert.equal(
      (
        await verifyImageEvidence({
          repository,
          tag,
          revision,
          ...files,
        })
      ).digest,
      digest,
    );
  }));

test("rejects a changed artifact and unexpected evidence fields", () =>
  withFixture(async (files) => {
    const evidence = await createImageEvidence({
      repository,
      tag,
      revision,
      digest,
      ...files,
    });
    await writeFile(files.evidenceFile, JSON.stringify(evidence));
    await writeFile(files.sbom, '{"spdx":"changed"}\n');
    await assert.rejects(
      verifyImageEvidence({ repository, tag, revision, ...files }),
      /sbom_sha256 does not match/u,
    );

    await writeFile(
      files.evidenceFile,
      JSON.stringify({ ...evidence, untrusted: true }),
    );
    await assert.rejects(
      readImageEvidence(files.evidenceFile),
      /fields do not match the strict schema/u,
    );
  }));

test("rejects a mutable tag or unsupported repository identity", () =>
  withFixture(async (files) => {
    await assert.rejects(
      createImageEvidence({
        repository: "docker.io/rodrgds/openpost",
        tag: "latest",
        revision,
        digest,
        ...files,
      }),
      /lowercase GHCR repository; tag must be sha-<revision>/u,
    );
  }));

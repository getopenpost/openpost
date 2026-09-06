import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateMarketingDiscoveryArtifacts,
  renderARDManifest,
  renderMCPServerCard,
} from "./public-agent-discovery.mjs";

const expectedArtifactURLs = [
  {
    identifier: "urn:air:openpo.st:api:openpost",
    url: "https://openpo.st/openapi.json",
  },
  {
    identifier: "urn:air:openpo.st:mcp:openpost",
    url: "https://openpo.st/.well-known/mcp/server-card.json",
  },
  {
    identifier: "urn:air:openpo.st:skill:openpost-cli",
    url: "https://openpo.st/.well-known/agent-skills/openpost-cli.tar.gz",
  },
];

test("current MCP server card describes the real remote endpoint", () => {
  assert.deepEqual(renderMCPServerCard("4.16.0"), {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "getopenpost/openpost",
    version: "4.16.0",
    description: "Create, schedule, publish, and inspect social content through OpenPost.",
    title: "OpenPost MCP server",
    websiteUrl: "https://openpo.st",
    repository: {
      url: "https://github.com/getopenpost/openpost",
      source: "github",
    },
    icons: [{ src: "https://openpo.st/icon.svg", mimeType: "image/svg+xml" }],
    remotes: [
      {
        type: "streamable-http",
        url: "https://app.openpo.st/mcp",
        supportedProtocolVersions: ["2025-06-18", "2025-03-26"],
      },
    ],
  });
});

test("ARD manifest advertises only implemented integration artifacts", () => {
  const { entries } = renderARDManifest();
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map(({ identifier, url }) => ({ identifier, url })),
    expectedArtifactURLs,
  );
  assert.ok(entries.every((entry) => entry.representativeQueries.length >= 2));
  assert.ok(entries.every((entry) => entry.representativeQueries.length <= 5));
});

test("marketing discovery build publishes a verifiable complete CLI skill", async (t) => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-agent-discovery-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));

  await generateMarketingDiscoveryArtifacts({ outputDirectory, version: "4.16.0" });

  const skillIndex = JSON.parse(
    await readFile(path.join(outputDirectory, ".well-known/agent-skills/index.json"), "utf8"),
  );
  assert.equal(skillIndex.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  assert.equal(skillIndex.skills.length, 1);
  const [skill] = skillIndex.skills;
  assert.equal(skill.name, "openpost-cli");
  assert.equal(skill.type, "archive");
  assert.match(
    skill.description,
    /^Operate a running OpenPost instance through the openpost CLI\./u,
  );
  assert.equal(skill.url, "/.well-known/agent-skills/openpost-cli.tar.gz");

  const archivePath = path.join(outputDirectory, ".well-known/agent-skills/openpost-cli.tar.gz");
  const archive = await readFile(archivePath);
  assert.equal(skill.digest, `sha256:${createHash("sha256").update(archive).digest("hex")}`);
  assert.ok((await stat(archivePath)).size > 0);

  const firstDigest = skill.digest;
  await generateMarketingDiscoveryArtifacts({ outputDirectory, version: "4.16.0" });
  const regeneratedIndex = JSON.parse(
    await readFile(path.join(outputDirectory, ".well-known/agent-skills/index.json"), "utf8"),
  );
  assert.equal(regeneratedIndex.skills[0].digest, firstDigest);

  const generatedManifest = JSON.parse(
    await readFile(path.join(outputDirectory, ".well-known/ard.json"), "utf8"),
  );
  assert.deepEqual(
    generatedManifest.entries.map(({ identifier, url }) => ({ identifier, url })),
    expectedArtifactURLs,
  );
  const generatedCard = JSON.parse(
    await readFile(path.join(outputDirectory, ".well-known/mcp/server-card.json"), "utf8"),
  );
  assert.equal(generatedCard.version, "4.16.0");
  assert.equal(generatedCard.remotes[0].url, "https://app.openpo.st/mcp");
  assert.deepEqual(
    await readFile(path.join(outputDirectory, "openapi.json")),
    await readFile(path.resolve(import.meta.dirname, "../apps/web/openapi.json")),
  );
});

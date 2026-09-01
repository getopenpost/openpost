import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";
import { create as createTar } from "tar";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDirectory = path.join(repositoryRoot, "skills/openpost-cli");
const mcpServerCardBase = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "backend/internal/api/handlers/mcp_server_card_base.json"),
    "utf8",
  ),
);
const ardSkillDescription =
  "Operate a running OpenPost instance through the openpost CLI for safe publishing, scheduling, inspection, and recovery workflows.";

function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderMCPServerCard(version) {
  return {
    ...mcpServerCardBase,
    version,
    remotes: mcpServerCardBase.remotes.map((remote) => ({
      ...remote,
      url: "https://app.openpo.st/mcp",
    })),
  };
}

export function renderARDManifest() {
  return {
    entries: [
      {
        identifier: "urn:air:openpo.st:api:openpost",
        displayName: "OpenPost HTTP API",
        type: "application/vnd.oai.openapi+json",
        url: "https://openpo.st/openapi.json",
        description:
          "Authenticated HTTP API for OpenPost workspaces, publications, renditions, media, providers, jobs, analytics, and billing.",
        capabilities: ["OpenAPI", "social-publishing", "content-operations"],
        representativeQueries: [
          "create and schedule a social publication through an HTTP API",
          "inspect publishing jobs and rendition outcomes in an OpenPost workspace",
        ],
      },
      {
        identifier: "urn:air:openpo.st:mcp:openpost",
        displayName: "OpenPost MCP server",
        type: "application/mcp-server-card+json",
        url: "https://openpo.st/.well-known/mcp/server-card.json",
        description:
          "Remote MCP server for scoped discovery and execution of OpenPost publishing operations.",
        capabilities: ["MCP", "social-publishing", "content-operations"],
        representativeQueries: [
          "use MCP to draft and schedule social content in OpenPost",
          "find an OpenPost operation and inspect its current publishing result",
        ],
      },
      {
        identifier: "urn:air:openpo.st:skill:openpost-cli",
        displayName: "OpenPost CLI Agent Skill",
        type: "application/gzip",
        url: "https://openpo.st/.well-known/agent-skills/openpost-cli.tar.gz",
        description: ardSkillDescription,
        capabilities: ["Agent Skills", "CLI", "social-publishing"],
        representativeQueries: [
          "operate an OpenPost instance safely from the command line",
          "create, validate, schedule, or recover an OpenPost publication with the CLI",
        ],
      },
    ],
  };
}

async function latestReleasedVersion(changelogPath = path.join(repositoryRoot, "CHANGELOG.md")) {
  const changelog = await readFile(changelogPath, "utf8");
  const match =
    /^## \[((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\] - \d{4}-\d{2}-\d{2}$/mu.exec(
      changelog,
    );
  if (!match) throw new Error("CHANGELOG.md does not contain a dated stable release");
  return match[1];
}

async function writeAgentSkill(outputDirectory) {
  const agentSkillsDirectory = path.join(outputDirectory, ".well-known/agent-skills");
  const archivePath = path.join(agentSkillsDirectory, "openpost-cli.tar.gz");
  const skillSource = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(skillSource);
  if (!frontmatter) throw new Error("skills/openpost-cli/SKILL.md must contain YAML frontmatter");
  const skill = parseYaml(frontmatter[1]);
  if (skill?.name !== "openpost-cli" || typeof skill.description !== "string") {
    throw new Error("skills/openpost-cli/SKILL.md must declare its canonical name and description");
  }
  await mkdir(agentSkillsDirectory, { recursive: true });
  await createTar(
    {
      cwd: skillDirectory,
      file: archivePath,
      gzip: true,
      mtime: new Date(0),
      portable: true,
      sync: false,
    },
    ["SKILL.md", "agents/openai.yaml", "references/workflows.md"],
  );
  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  await writeFile(
    path.join(agentSkillsDirectory, "index.json"),
    jsonDocument({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: "openpost-cli",
          type: "archive",
          description: skill.description,
          url: "/.well-known/agent-skills/openpost-cli.tar.gz",
          digest: `sha256:${digest}`,
        },
      ],
    }),
    "utf8",
  );
}

export async function generateMarketingDiscoveryArtifacts({ outputDirectory, version } = {}) {
  if (!outputDirectory) throw new Error("outputDirectory is required");
  const releaseVersion = version ?? (await latestReleasedVersion());
  const wellKnownDirectory = path.join(outputDirectory, ".well-known");
  const mcpDirectory = path.join(wellKnownDirectory, "mcp");
  await mkdir(mcpDirectory, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(repositoryRoot, "frontend/openapi.json"),
      path.join(outputDirectory, "openapi.json"),
    ),
    writeFile(path.join(wellKnownDirectory, "ard.json"), jsonDocument(renderARDManifest()), "utf8"),
    writeFile(
      path.join(mcpDirectory, "server-card.json"),
      jsonDocument(renderMCPServerCard(releaseVersion)),
      "utf8",
    ),
  ]);
  await writeAgentSkill(outputDirectory);
}

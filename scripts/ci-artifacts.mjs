#!/usr/bin/env bun

export function selectAttemptArtifact(artifacts, prefix) {
  if (!Array.isArray(artifacts)) {
    throw new Error("workflow artifacts must be an array");
  }
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new Error("artifact prefix is required");
  }

  const candidates = artifacts
    .filter((artifact) => artifact?.expired === false)
    .flatMap((artifact) => {
      const name = String(artifact?.name ?? "");
      if (!name.startsWith(prefix)) return [];
      const suffix = name.slice(prefix.length);
      if (!/^[1-9][0-9]*$/u.test(suffix)) return [];
      return [{ attempt: Number(suffix), name }];
    })
    .sort((left, right) => right.attempt - left.attempt);

  if (candidates.length === 0) {
    throw new Error(`no current artifact matches ${JSON.stringify(prefix)}`);
  }
  const latest = candidates.filter(
    (candidate) => candidate.attempt === candidates[0].attempt,
  );
  if (latest.length !== 1) {
    throw new Error(
      `artifact attempt ${candidates[0].attempt} is not uniquely identified`,
    );
  }
  return latest[0].name;
}

export function resolveRunArtifact({ repository, runId, prefix }) {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(String(repository ?? ""))) {
    throw new Error("repository must use owner/name format");
  }
  if (!/^[1-9][0-9]*$/u.test(String(runId ?? ""))) {
    throw new Error("run id must be a positive integer");
  }

  const result = Bun.spawnSync(
    [
      "gh",
      "api",
      "--paginate",
      `repos/${repository}/actions/runs/${runId}/artifacts`,
      "--jq",
      ".artifacts[] | @json",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `could not list workflow artifacts: ${result.stderr.toString().trim()}`,
    );
  }
  const artifacts = result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return selectAttemptArtifact(artifacts, prefix);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  try {
    if (process.argv[2] !== "resolve") {
      throw new Error(
        "usage: ci-artifacts.mjs resolve --repository owner/name --run-id ID --prefix PREFIX",
      );
    }
    console.log(
      resolveRunArtifact({
        repository: option("--repository"),
        runId: option("--run-id"),
        prefix: option("--prefix"),
      }),
    );
  } catch (error) {
    console.error(`ci-artifacts: ${error.message}`);
    process.exitCode = 1;
  }
}

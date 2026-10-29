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
  const latest = candidates.filter((candidate) => candidate.attempt === candidates[0].attempt);
  if (latest.length !== 1) {
    throw new Error(`artifact attempt ${candidates[0].attempt} is not uniquely identified`);
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
    { stdout: "pipe", stderr: "pipe", timeout: 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(`could not list workflow artifacts: ${result.stderr.toString().trim()}`);
  }
  const artifacts = result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return selectAttemptArtifact(artifacts, prefix);
}

// Start runner preparation while builds run, then consume only an artifact
// whose producer finished successfully in this same workflow run.
export async function waitForRunArtifact(
  options,
  {
    jobs = () => {
      const result = Bun.spawnSync(
        [
          "gh",
          "api",
          "--paginate",
          `repos/${options.repository}/actions/runs/${options.runId}/jobs?filter=all&per_page=100`,
          "--jq",
          ".jobs[] | @json",
        ],
        { stdout: "pipe", stderr: "pipe", timeout: 30_000 },
      );
      if (result.exitCode !== 0) throw new Error("could not inspect artifact producer jobs");
      return result.stdout
        .toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    resolve = resolveRunArtifact,
    now = Date.now,
    pause = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {},
) {
  if (
    !/^[^/\s]+\/[^/\s]+$/u.test(String(options.repository ?? "")) ||
    !/^[1-9][0-9]*$/u.test(String(options.runId ?? "")) ||
    !options.producer ||
    !options.prefix
  ) {
    throw new Error("repository, run id and producer are required");
  }
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("invalid artifact wait timeout");
  const deadline = now() + timeoutMs;
  let pollError;
  while (now() < deadline) {
    let entries;
    try {
      entries = jobs();
      pollError = undefined;
    } catch (error) {
      pollError = error;
      await pause(Math.max(0, Math.min(15_000, deadline - now())));
      continue;
    }
    if (!Array.isArray(entries)) throw new Error("producer jobs must be an array");
    const attempts = entries.filter((job) => job.name === options.producer);
    const latest = Math.max(0, ...attempts.map((job) => job.run_attempt ?? 1));
    if (!Number.isInteger(latest)) throw new Error("invalid artifact producer attempt");
    const matches = attempts.filter((job) => (job.run_attempt ?? 1) === latest);
    if (matches.length > 1) throw new Error("artifact producer is ambiguous");
    const producer = matches[0];
    if (producer?.status === "completed") {
      if (producer.conclusion !== "success")
        throw new Error(`Artifact producer ${options.producer}: ${producer.conclusion}`);
      return resolve(options);
    }
    await pause(Math.min(15_000, deadline - now()));
  }
  throw new Error(
    `Timed out waiting for artifact producer ${options.producer}${pollError ? `: ${pollError.message}` : ""}`,
  );
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  try {
    if (!["resolve", "wait"].includes(process.argv[2])) {
      throw new Error(
        "usage: ci-artifacts.mjs resolve --repository owner/name --run-id ID --prefix PREFIX; ci-artifacts.mjs wait --repository owner/name --run-id ID --prefix PREFIX --producer NAME",
      );
    }
    console.log(
      await (process.argv[2] === "wait" ? waitForRunArtifact : resolveRunArtifact)({
        repository: option("--repository"),
        runId: option("--run-id"),
        prefix: option("--prefix"),
        producer: option("--producer"),
      }),
    );
  } catch (error) {
    console.error(`ci-artifacts: ${error.message}`);
    process.exitCode = 1;
  }
}

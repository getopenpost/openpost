export function requireConventionalCommitMessage(message) {
  const header =
    String(message ?? "")
      .trim()
      .split(/\r?\n/u, 1)[0] ?? "";
  if (!/^[a-z][a-z0-9-]*(?:\([^)\r\n]+\))?!?:\s+\S/iu.test(header)) {
    throw new Error("uncommitted work requires a Conventional Commit message");
  }
  return header;
}

export function selectWorkflowRun(runs, { workflow, branch, revision }) {
  if (!Array.isArray(runs)) throw new Error(`${workflow} runs must be an array`);
  const match = runs.find((run) => run?.headBranch === branch);
  if (!match) return undefined;
  if (match.status === "completed" && match.conclusion !== "success") {
    throw new Error(`${workflow} failed for ${revision}: ${match.conclusion}`);
  }
  if (!Number.isInteger(Number(match.databaseId)) || Number(match.attempt) < 1) {
    throw new Error(`${workflow} returned an invalid run identity for ${revision}`);
  }
  return { id: String(match.databaseId), attempt: Number(match.attempt) };
}

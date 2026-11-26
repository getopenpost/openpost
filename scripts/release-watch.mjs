// Decides when `release ship` can stop watching a workflow run.
//
// Completion jobs define success. Background jobs (independent package
// publications) never hold the command open once completion is reached, but
// the watch loop still reports them as failures if they finish failed first.
// Optional jobs only report. Every other job must have finished.
export function releaseWatchSettlement(
  jobs,
  { completion = [], background = new Set(), optional = new Set() } = {},
) {
  const completed =
    completion.length > 0 &&
    completion.every((name) =>
      jobs.some((job) => job.name === name && job.conclusion === "success"),
    );
  const unfinished = jobs.filter((job) => job.status !== "completed" && !optional.has(job.name));
  const blocking = unfinished.filter((job) => !background.has(job.name));
  return {
    settled: completed && blocking.length === 0,
    inFlight: unfinished.filter((job) => background.has(job.name)),
  };
}

#!/usr/bin/env bun

const startedAt = performance.now();

await run("checks", ["check"]);
await runParallel([
  ["lint", ["lint"]],
  ["backend tests", ["backend-test"]],
  ["frontend unit tests", ["frontend-unit-test"]],
  [
    "shared package tests",
    ["bun", "run", "--filter", "@openpost/video-project", "test"],
  ],
  ["CLI tests", ["cli-test"]],
]);

console.log(
  `release-check: passed in ${formatDuration(performance.now() - startedAt)}`,
);

async function run(label, command) {
  const stageStartedAt = performance.now();
  console.log(`\n==> ${label}: ${command.join(" ")}`);
  const process = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0)
    throw new Error(`${label} failed with exit code ${exitCode}`);
  console.log(
    `<== ${label}: ${formatDuration(performance.now() - stageStartedAt)}`,
  );
}

async function runParallel(stages) {
  const running = stages.map(([label, command]) => {
    const stageStartedAt = performance.now();
    console.log(`\n==> ${label}: ${command.join(" ")}`);
    const process = Bun.spawn(command, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return { label, process, stageStartedAt };
  });

  try {
    await Promise.all(
      running.map(async ({ label, process, stageStartedAt }) => {
        const exitCode = await process.exited;
        if (exitCode !== 0)
          throw new Error(`${label} failed with exit code ${exitCode}`);
        console.log(
          `<== ${label}: ${formatDuration(performance.now() - stageStartedAt)}`,
        );
      }),
    );
  } catch (error) {
    for (const { process } of running) process.kill();
    throw error;
  }
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

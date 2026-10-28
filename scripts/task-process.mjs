// A hung step used to block a task for hours. Keep a bounded default.
export const DEFAULT_STEP_TIMEOUT_MS = 30 * 60_000;

const activeProcessGroups = new Set();

export function killProcessGroup(group, signal) {
  try {
    process.kill(-group, signal);
    return true;
  } catch {
    return false;
  }
}

export async function stopProcessGroup(group) {
  killProcessGroup(group, "SIGKILL");
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline && killProcessGroup(group, 0)) {
    await Bun.sleep(20);
  }
}

export function stopActiveProcessGroups() {
  for (const group of activeProcessGroups) killProcessGroup(group, "SIGKILL");
}

process.on("exit", stopActiveProcessGroups);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopActiveProcessGroups();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

// Never attach stdin unless a step explicitly supplies input, so a missing
// binary cannot sit on an install prompt. Steps own their process group so a
// timed-out build cannot leave descendants writing generated output after the
// step reports that it stopped.
export async function spawnTaskProcess(argv, options = {}, signal) {
  if (signal?.aborted) return 1;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? "ignore" : new Blob([options.input]),
    stdout: "inherit",
    stderr: "inherit",
    detached: true,
  });
  const group = child.pid;
  activeProcessGroups.add(group);
  let timedOut = false;
  let killTimer;
  const stop = (force = false) => {
    const stopped = killProcessGroup(group, force ? "SIGKILL" : "SIGTERM");
    if (!stopped && !force) child.kill();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
    killTimer = setTimeout(() => stop(true), 5_000);
  }, timeoutMs);
  const abort = () => {
    stop();
    killTimer ??= setTimeout(() => stop(true), 5_000);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const status = await child.exited;
    if (timedOut) {
      process.stderr.write(
        `✗ ${argv.join(" ")} exceeded ${Math.round(timeoutMs / 1_000)}s and was stopped\n`,
      );
      return 124;
    }
    return status;
  } finally {
    clearTimeout(timer);
    if (killTimer !== undefined) clearTimeout(killTimer);
    signal?.removeEventListener("abort", abort);
    if (timedOut || signal?.aborted) await stopProcessGroup(group);
    activeProcessGroups.delete(group);
  }
}

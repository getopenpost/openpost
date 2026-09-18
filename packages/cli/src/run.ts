import { spawn } from "node:child_process";
import { resolveBinaryPath, type CliBinary } from "./resolve.js";

// runBinary resolves the release binary and execs it with inherited stdio,
// so interactive login flows and TTY prompts keep working through npx. The
// child exit code passes through unchanged, and signal termination is
// re-raised on the wrapper so supervisors observe the original signal.
export async function runBinary(binary: CliBinary, argv: string[]): Promise<never> {
  const executable = await resolveBinaryPath({ binary });
  const child = spawn(executable, argv, { stdio: "inherit", windowsHide: true });
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("error", () => resolve({ code: null, signal: null }));
      child.on("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  if (outcome.signal !== null) {
    // Re-raise so the wrapper dies with the same signal instead of
    // masquerading as exit 1. The default disposition terminates us.
    process.kill(process.pid, outcome.signal);
    process.exit(128);
  }
  if (outcome.code === null) {
    console.error(`error: failed to launch ${executable}`);
    process.exit(1);
  }
  process.exit(outcome.code);
}

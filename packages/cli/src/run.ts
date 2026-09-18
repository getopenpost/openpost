import { spawn } from "node:child_process";
import { resolveBinaryPath, type CliBinary } from "./resolve.js";

// runBinary resolves the release binary and execs it with inherited stdio,
// so interactive login flows and TTY prompts keep working through npx. The
// child exit code passes through unchanged.
export async function runBinary(binary: CliBinary, argv: string[]): Promise<never> {
  const executable = await resolveBinaryPath({ binary });
  const child = spawn(executable, argv, { stdio: "inherit", windowsHide: true });
  const code = await new Promise<number | null>((resolve) => {
    child.on("error", () => resolve(null));
    child.on("exit", (exitCode) => resolve(exitCode));
  });
  if (code === null) {
    console.error(`error: failed to launch ${executable}`);
    process.exit(1);
  }
  process.exit(code);
}

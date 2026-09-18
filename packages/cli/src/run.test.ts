import { afterEach, describe, expect, it, vi } from "vitest";
import { runBinary } from "./run.js";

function exitToMessage(promise: Promise<never>): Promise<unknown> {
  return promise.catch((error: Error) => error.message);
}

describe("runBinary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passes the child exit code through", async () => {
    vi.stubEnv("OPENPOST_CLI_BIN", "/bin/sh");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:7");
    }) as never);
    const promise = exitToMessage(runBinary("openpost-cli", ["-c", "exit 7"]));
    await expect(promise).resolves.toBe("exit:7");
    expect(exit).toHaveBeenCalledWith(7);
  });

  it("re-raises the child signal instead of exiting 1", async () => {
    vi.stubEnv("OPENPOST_CLI_BIN", "/bin/sh");
    const kill = vi.spyOn(process, "kill").mockImplementation((() => undefined) as never);
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:128");
    }) as never);
    const promise = exitToMessage(runBinary("openpost-cli", ["-c", "kill -TERM $$"]));
    await expect(promise).resolves.toBe("exit:128");
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
  });

  it("exits 1 when the child cannot launch", async () => {
    vi.stubEnv("OPENPOST_CLI_BIN", "/nonexistent-openpost-binary");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit:1");
    }) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const promise = exitToMessage(runBinary("openpost-cli", []));
    await expect(promise).resolves.toBe("exit:1");
    expect(error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

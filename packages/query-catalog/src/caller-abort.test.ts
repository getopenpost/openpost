import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { runWithCallerAbort, throwIfAborted } from "./caller-abort";

describe("caller-local query cancellation", () => {
  it("supports native signals without modern abort methods or DOMException", async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
    Object.defineProperty(controller.signal, "reason", { value: undefined });
    vi.stubGlobal("DOMException", undefined);
    try {
      expect(() => throwIfAborted(controller.signal)).not.toThrow();
      controller.abort();
      expect(() => throwIfAborted(controller.signal)).toThrow(
        expect.objectContaining({ name: "AbortError" }),
      );
      await expect(
        runWithCallerAbort(controller.signal, async () => "unexpected"),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects only the aborted caller while a shared observer receives the result", async () => {
    const queryClient = new QueryClient();
    const request = deferred<string>();
    const requestStarted = deferred<void>();
    let requestSignal: AbortSignal | undefined;
    const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
      requestSignal = signal;
      requestStarted.resolve();
      return request.promise;
    });
    const options = { queryKey: ["caller-abort", "shared"] as const, queryFn };
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => undefined);
    await requestStarted.promise;
    const controller = new AbortController();
    const caller = runWithCallerAbort(controller.signal, () => queryClient.fetchQuery(options));

    controller.abort();

    await expect(caller).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(false);
    request.resolve("ready");
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe("ready"));
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    queryClient.clear();
  });

  it("does not start work for an already aborted caller", async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => "ready");
    controller.abort();

    await expect(runWithCallerAbort(controller.signal, run)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(run).not.toHaveBeenCalled();
  });
});

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value | PromiseLike<Value>) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: Deferred<Value>["resolve"];
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

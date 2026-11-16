import { describe, expect, mock, test } from "bun:test";

import { createServerChoice, serverChoiceErrorMessage } from "./server-choice";

describe("server choice", () => {
  test("uses the same proxy credentials for probing and saving", async () => {
    const probe = mock(async () => ({
      ok: true as const,
      baseUrl: "https://proxy.example",
    }));
    const persist = mock(async () => undefined);
    const headers = [{ name: "P-Access-Token", value: "device-secret" }];
    const choice = createServerChoice({ probe, persist });
    const pending = choice.start("proxy.example", headers);
    headers[0].value = "edited-while-connecting";
    await pending;
    expect(probe).toHaveBeenCalledWith("proxy.example", [
      { name: "P-Access-Token", value: "device-secret" },
    ]);
    expect(persist).toHaveBeenCalledWith("https://proxy.example", [
      { name: "P-Access-Token", value: "device-secret" },
    ]);
  });
  test("surfaces a storage failure and allows retry", async () => {
    let shouldFail = true;
    const persist = mock(async () => {
      if (shouldFail) throw new Error("SecureStore set failed");
    });
    const choice = createServerChoice({
      probe: async () => ({ ok: true, baseUrl: "https://new.example.com" }),
      persist,
    });

    const first = choice.start("https://new.example.com");
    expect(first).not.toBeNull();
    await expect(first).rejects.toThrow("SecureStore set failed");
    expect(serverChoiceErrorMessage(new Error("SecureStore set failed"))).toContain("Try again");

    shouldFail = false;
    await expect(choice.start("https://new.example.com")).resolves.toEqual({
      status: "connected",
    });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  test("ignores another choice while persistence is in progress", async () => {
    const write = deferred<void>();
    const persist = mock(async () => write.promise);
    const choice = createServerChoice({
      probe: async (target) => ({ ok: true, baseUrl: target }),
      persist,
    });

    const first = choice.start("https://first.example.com");
    const second = choice.start("https://second.example.com");
    write.resolve();
    await first;
    if (second) await second;

    expect(second).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

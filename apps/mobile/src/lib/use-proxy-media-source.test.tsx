import { afterEach, expect, spyOn, test } from "bun:test";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as proxyMedia from "./proxy-media";
import type { MediaSource } from "./media-source";
import { useProxyMediaSource } from "./use-proxy-media-source";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
let snapshot: ReturnType<typeof useProxyMediaSource>;
function Probe({ source }: { source: MediaSource }) {
  const result = useProxyMediaSource(source);
  useLayoutEffect(() => {
    snapshot = result;
  });
  return null;
}
async function render(source: MediaSource) {
  await act(async () => {
    const element = createElement(Probe, { source });
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

test("returning to a previous source waits for a new live temporary file", async () => {
  const requests: ((result: proxyMedia.TemporaryMedia) => void)[] = [];
  const spy = spyOn(proxyMedia, "downloadProxyMedia").mockImplementation(
    () =>
      new Promise((resolve) => {
        requests.push(resolve);
      }),
  );
  let disposed = false;
  const sourceA = { uri: "https://proxy.example.com/media/a", headers: { "X-Proxy": "secret" } };
  const sourceB = { uri: "https://proxy.example.com/media/b", headers: { "X-Proxy": "secret" } };
  try {
    await render(sourceA);
    await act(async () =>
      requests[0]({
        uri: "file:///old-a",
        contentType: "image/png",
        dispose() {
          disposed = true;
        },
      }),
    );
    expect(snapshot.source?.uri).toBe("file:///old-a");
    await render(sourceB);
    expect(disposed).toBe(true);
    await render(sourceA);
    expect(snapshot.source).toBeNull();
    expect(requests).toHaveLength(3);
    await act(async () =>
      requests[2]({ uri: "file:///new-a", contentType: "image/png", dispose() {} }),
    );
    expect(snapshot.source).toEqual({ uri: "file:///new-a" });
  } finally {
    spy.mockRestore();
  }
});

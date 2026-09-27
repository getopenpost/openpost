import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const writes: string[] = [];
const posts: string[] = [];
const secureValues = new Map<string, string>();
let beginUploadError = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const path = url.pathname.replace("/api/v1", "");
  posts.push(path);
  if (path.endsWith("begin-upload") && beginUploadError) {
    return Response.json({ message: "asset is not pending" }, { status: 409 });
  }
  if (path === "/video-projects") return Response.json({ id: "project-1" });
  if (path.endsWith("/assets")) return Response.json({ id: "asset-1" });
  return Response.json({});
}) as typeof fetch;

const queuePath = "file:///mobile/video-project-captures/queue.json";

mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "file:///mobile/",
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    files.set(to, from);
  },
  deleteAsync: async (uri: string) => void files.delete(uri),
  getInfoAsync: async (uri: string) => ({
    exists: files.has(uri),
    size: files.get(uri)?.length ?? 0,
  }),
  makeDirectoryAsync: async () => undefined,
  readAsStringAsync: async (uri: string) => {
    const value = files.get(uri);
    if (value === undefined) throw new Error("File does not exist");
    return value;
  },
  uploadAsync: async () => ({ status: 200 }),
  writeAsStringAsync: async (uri: string, value: string) => {
    writes.push(value);
    files.set(uri, value);
  },
}));
mock.module("expo-file-system", () => ({
  File: class {
    constructor(uri: string) {
      if (!uri.startsWith("file:")) throw new Error("Expected a local file URI");
    }
    readableStream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });
    }
  },
}));
mock.module("expo-network", () => ({
  getNetworkStateAsync: async () => ({
    isConnected: true,
    isInternetReachable: true,
    type: "WIFI",
  }),
}));
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secureValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secureValues.set(key, value),
  deleteItemAsync: async (key: string) => void secureValues.delete(key),
}));

const { pendingVideoCaptureCount, queueVideoCapture, syncPendingVideoCaptures } =
  await import("./video-projects");
const { clearServer, setServer } = await import("./server");
const { captureApiRequestIdentity, commitTokenForIdentity } = await import("./api/client");

function queuedCapture() {
  return {
    id: "capture-1",
    workspaceId: "workspace-1",
    name: "Capture",
    uri: "file:///mobile/video.mp4",
    filename: "capture.mp4",
    mimeType: "video/mp4",
    size: 3,
    sha256: "abc",
    durationSeconds: 1,
    width: 640,
    height: 480,
    preparation: {},
    queuedAt: 1,
  };
}

describe("mobile video capture persistence and upload", () => {
  beforeEach(() => {
    files.clear();
    writes.length = 0;
    posts.length = 0;
    beginUploadError = false;
  });

  afterEach(() => {
    files.clear();
    globalThis.fetch = originalFetch;
  });

  test("stops a capture upload when the server rejects begin-upload", async () => {
    files.set(queuePath, JSON.stringify([queuedCapture()]));
    beginUploadError = true;
    await clearServer();
    await setServer("https://mobile.example.test");
    await commitTokenForIdentity("mobile-token", captureApiRequestIdentity());
    let uploadError: unknown;
    try {
      await syncPendingVideoCaptures("workspace-1");
    } catch (error) {
      uploadError = error;
    }

    expect(posts).toEqual([
      "/video-projects",
      "/video-projects/project-1/assets",
      "/video-projects/project-1/assets/asset-1/begin-upload",
    ]);
    expect(uploadError).toBeInstanceOf(Error);
    expect(await pendingVideoCaptureCount("workspace-1")).toBe(1);
  });

  test("does not replace an unreadable capture queue when adding a capture", async () => {
    const unreadableQueue = "{corrupt queue";
    files.set(queuePath, unreadableQueue);

    await expect(
      queueVideoCapture(
        "workspace-1",
        {
          uri: "file:///incoming.mp4",
          fileName: "incoming.mp4",
          width: 640,
          height: 480,
        },
        {},
      ),
    ).rejects.toThrow("Saved capture queue could not be read");

    expect(files.get(queuePath)).toBe(unreadableQueue);
    expect(writes).toHaveLength(0);
  });
});

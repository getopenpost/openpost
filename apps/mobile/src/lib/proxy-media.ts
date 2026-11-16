import type { MediaSource } from "./media-source";
import { proxyFetch } from "./proxy-fetch";

export type TemporaryMedia = {
  uri: string;
  contentType: string;
  dispose: () => void;
};

type TemporaryFile = {
  uri: string;
  create: () => void;
  delete: () => void;
  writableStream: () => WritableStream<Uint8Array<ArrayBufferLike>>;
};

type DownloadDependencies = {
  fetch: (uri: string, init: RequestInit) => Promise<Response>;
  createFile: (extension: string) => Promise<TemporaryFile>;
};

const nativeDependencies: DownloadDependencies = {
  fetch: proxyFetch,
  createFile: async (extension) => {
    const { File, Paths } = await import("expo-file-system");
    return new File(
      Paths.cache,
      `proxy-media-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
    );
  },
};

export function hasProxyMediaHeaders(source: MediaSource | null): boolean {
  return Object.keys(source?.headers ?? {}).some((name) => name.toLowerCase() !== "authorization");
}

// Native image, video and download clients follow redirects and can forward
// arbitrary headers. Download proxy-protected sources with the redirect-safe
// transport, then give native renderers only a temporary local file.
export async function downloadProxyMedia(
  source: MediaSource,
  signal: AbortSignal,
  dependencies: DownloadDependencies = nativeDependencies,
): Promise<TemporaryMedia> {
  const response = await dependencies.fetch(source.uri, {
    headers: source.headers,
    redirect: "error",
    signal,
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Could not load this attachment.");
  }
  const contentType =
    response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  let file: TemporaryFile | undefined;
  const dispose = () => {
    try {
      file?.delete();
    } catch {
      /* Already removed by the OS. */
    }
  };
  const reader = response.body.getReader();
  let writer: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>> | undefined;
  try {
    file = await dependencies.createFile(extensions[contentType] ?? ".bin");
    file.create();
    writer = file.writableStream().getWriter();
    while (true) {
      if (signal.aborted)
        throw Object.assign(new Error("Attachment request cancelled."), { name: "AbortError" });
      const chunk = await reader.read();
      if (chunk.done) break;
      // Await each write so video-sized responses never accumulate in memory.
      await writer.write(chunk.value);
    }
    if (signal.aborted)
      throw Object.assign(new Error("Attachment request cancelled."), { name: "AbortError" });
    await writer.close();
    return { uri: file.uri, contentType, dispose };
  } catch (cause) {
    await writer?.abort().catch(() => undefined);
    dispose();
    throw cause;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    writer?.releaseLock();
  }
}

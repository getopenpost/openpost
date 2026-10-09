import { mock } from "bun:test";

export const files = new Map<string, string>();
export const writes: string[] = [];
export const uploads: { uri: string; size: number }[] = [];

export function resetFileSystem() {
  files.clear();
  writes.length = 0;
  uploads.length = 0;
}

mock.module("expo-file-system/legacy", () => ({
  documentDirectory: "file:///mobile/",
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    const contents = files.get(from);
    if (contents === undefined) throw new Error("File does not exist");
    files.set(to, contents);
  },
  deleteAsync: async (uri: string) => void files.delete(uri),
  getInfoAsync: async (uri: string) => ({
    exists: files.has(uri),
    isDirectory: false,
    size: new TextEncoder().encode(files.get(uri) ?? "").byteLength,
  }),
  makeDirectoryAsync: async () => undefined,
  readAsStringAsync: async (uri: string) => {
    const value = files.get(uri);
    if (value === undefined) throw new Error("File does not exist");
    return value;
  },
  uploadAsync: async (_url: string, uri: string, options: { headers: Record<string, string> }) => {
    const size = Number(options.headers["Content-Length"]);
    uploads.push({ uri, size });
    return {
      status: size === new TextEncoder().encode(files.get(uri) ?? "").byteLength ? 200 : 403,
      body: "",
    };
  },
  writeAsStringAsync: async (uri: string, value: string) => {
    writes.push(value);
    files.set(uri, value);
  },
}));

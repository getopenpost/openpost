import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  mediaMetadataQueryOptions,
  mediaQueryKeys,
  reconcileMediaListItemMutation,
  type MediaMetadataResult,
  type MediaListItem,
  type MediaListResult,
} from "./media";

function mediaItem(id: string, filename: string): MediaListItem {
  return { id, original_filename: filename } as MediaListItem;
}

describe("media query cache", () => {
  it("normalizes metadata IDs into one stable Workspace key", () => {
    expect(mediaQueryKeys.metadata("workspace-1", [" media-b ", "media-a", "media-b", ""])).toEqual(
      mediaQueryKeys.metadata("workspace-1", ["media-a", "media-b"]),
    );
  });

  it("deduplicates metadata reads and forwards Query cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    let finishRead = (_result: MediaMetadataResult) => {};
    const getMediaMetadata = vi.fn(
      (_workspaceId: string, _mediaIds: readonly string[], signal: AbortSignal) => {
        observedSignal = signal;
        return new Promise<MediaMetadataResult>((resolve) => {
          finishRead = resolve;
        });
      },
    );
    const client = new QueryClient();
    const options = mediaMetadataQueryOptions({ getMediaMetadata }, "workspace-1", [
      "media-b",
      "media-a",
    ]);

    const first = client.fetchQuery(options);
    const second = client.fetchQuery(options);
    await Promise.resolve();
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
    expect(getMediaMetadata).toHaveBeenCalledTimes(1);

    await client.cancelQueries({ queryKey: options.queryKey, exact: true });
    expect(observedSignal?.aborted).toBe(true);
    finishRead({ media: [] });
    await Promise.allSettled([first, second]);
  });

  it("uses one key for equivalent normalized tag sets", () => {
    expect(
      mediaQueryKeys.list("workspace-1", {
        tagIds: [" tag-b ", "tag-a", "", "tag-b", "   "],
      }),
    ).toEqual(mediaQueryKeys.list("workspace-1", { tagIds: ["tag-a", "tag-b"] }));
  });

  it("cancels an older list read before projecting a successful mutation", async () => {
    const client = new QueryClient();
    const queryKey = mediaQueryKeys.list("workspace-1", { lifecycle: "library" });
    const stale = { media: [mediaItem("media-1", "old.png")], total: 1 } as MediaListResult;
    client.setQueryData(queryKey, stale);

    let releaseRead = () => {};
    let markReadStarted = () => {};
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const staleRead = client.fetchQuery({
      queryKey,
      staleTime: 0,
      queryFn: async ({ signal }) => {
        markReadStarted();
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return stale;
      },
    });
    await readStarted;

    await reconcileMediaListItemMutation(client, {
      workspaceId: "workspace-1",
      mediaId: "media-1",
      update: (item) => ({ ...item, original_filename: "new.png" }),
    });
    releaseRead();
    await staleRead.catch(() => undefined);

    expect(client.getQueryData<MediaListResult>(queryKey)?.media?.[0]?.original_filename).toBe(
      "new.png",
    );
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("does not project into a replacement auth session", async () => {
    const client = new QueryClient();
    const queryKey = mediaQueryKeys.list("workspace-1", {});
    client.setQueryData(queryKey, {
      media: [mediaItem("media-1", "old.png")],
      total: 1,
    } as MediaListResult);

    const reconciled = await reconcileMediaListItemMutation(client, {
      workspaceId: "workspace-1",
      mediaId: "media-1",
      update: (item) => ({ ...item, original_filename: "new.png" }),
      canReconcile: () => false,
    });

    expect(reconciled).toBe(false);
    expect(client.getQueryData<MediaListResult>(queryKey)?.media?.[0]?.original_filename).toBe(
      "old.png",
    );
  });

  it("reconciles only the workspace where the mutation began", async () => {
    const client = new QueryClient();
    const workspaceAKey = mediaQueryKeys.list("workspace-a", {});
    const workspaceBKey = mediaQueryKeys.list("workspace-b", {});
    for (const queryKey of [workspaceAKey, workspaceBKey]) {
      client.setQueryData(queryKey, {
        media: [mediaItem("media-1", "old.png")],
        total: 1,
      } as MediaListResult);
    }

    await reconcileMediaListItemMutation(client, {
      workspaceId: "workspace-a",
      mediaId: "media-1",
      update: (item) => ({ ...item, original_filename: "new.png" }),
    });

    expect(client.getQueryData<MediaListResult>(workspaceAKey)?.media?.[0]?.original_filename).toBe(
      "new.png",
    );
    expect(client.getQueryData<MediaListResult>(workspaceBKey)?.media?.[0]?.original_filename).toBe(
      "old.png",
    );
  });
});

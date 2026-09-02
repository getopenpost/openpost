import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import {
  mediaQueryKeys,
  reconcileMediaListItemMutation,
  type MediaListItem,
  type MediaListResult,
} from "./media";

function mediaItem(id: string, filename: string): MediaListItem {
  return { id, original_filename: filename } as MediaListItem;
}

describe("media query cache", () => {
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

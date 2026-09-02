import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  activityPublicationsQueryOptions,
  openPostQueryDefaults,
  openPostQueryKeys,
  publicationDetailQueryOptions,
  seedPublicationDetail,
  type Publication,
} from "./index";

describe("publication detail cache ordering", () => {
  it("does not let an older list response overwrite a newer detail value", async () => {
    const list = deferred<{ items: Publication[]; total: number; nextCursor: string }>();
    const listPublications = vi.fn(() => list.promise);
    const client = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const pending = client.fetchQuery(
      activityPublicationsQueryOptions(
        { listActivityPublications: listPublications },
        "workspace-1",
        "scheduled",
        { limit: 40 },
      ),
    );
    await vi.waitFor(() => expect(listPublications).toHaveBeenCalledOnce());

    const current = publication("published", 2, "2026-09-02T12:00:00Z");
    seedPublicationDetail(client, current, "workspace-1");
    list.resolve({
      items: [publication("scheduled", 1, "2026-09-02T11:00:00Z")],
      total: 1,
      nextCursor: "",
    });
    await pending;

    expect(
      client.getQueryData(openPostQueryKeys.publications.detail("workspace-1", "publication-1")),
    ).toEqual(current);
  });

  it("keeps a detail write that settles while an ambiguous list request is in flight", async () => {
    const list = deferred<{ items: Publication[]; total: number; nextCursor: string }>();
    const listPublications = vi.fn(() => list.promise);
    const client = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const pending = client.fetchQuery(
      activityPublicationsQueryOptions(
        { listActivityPublications: listPublications },
        "workspace-1",
        "scheduled",
        { limit: 40 },
      ),
    );
    await vi.waitFor(() => expect(listPublications).toHaveBeenCalledOnce());

    const current = publication("published", 2, "2026-09-02T12:00:00Z");
    seedPublicationDetail(client, current, "workspace-1");
    list.resolve({
      items: [publication("scheduled", 2, "2026-09-02T12:00:00Z")],
      total: 1,
      nextCursor: "",
    });
    await pending;

    expect(
      client.getQueryData(openPostQueryKeys.publications.detail("workspace-1", "publication-1")),
    ).toEqual(current);
  });

  it("does not let a stale detail request overwrite a value written after it started", async () => {
    const detail = deferred<Publication>();
    const getPublication = vi.fn(() => detail.promise);
    const client = new QueryClient({ defaultOptions: openPostQueryDefaults });
    const pending = client.fetchQuery(
      publicationDetailQueryOptions({ getPublication }, "workspace-1", "publication-1"),
    );
    await vi.waitFor(() => expect(getPublication).toHaveBeenCalledOnce());

    const current = publication("published", 2, "2026-09-02T12:00:00Z");
    seedPublicationDetail(client, current, "workspace-1");
    detail.resolve(publication("scheduled", 1, "2026-09-02T11:00:00Z"));

    await expect(pending).resolves.toEqual(current);
    expect(
      client.getQueryData(openPostQueryKeys.publications.detail("workspace-1", "publication-1")),
    ).toEqual(current);
  });
});

function publication(status: string, revision: number, updatedAt: string): Publication {
  return {
    id: "publication-1",
    revision,
    status,
    updated_at: updatedAt,
    workspace_id: "workspace-1",
  } as Publication;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

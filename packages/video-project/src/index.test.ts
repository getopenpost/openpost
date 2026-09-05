import { describe, expect, it, vi } from "vitest";
import {
  overlappingTargets,
  portableVideoProjectDocument,
  VideoProjectMutationOutbox,
  type PendingVideoProjectMutation,
} from "./index";

function mutation(id: string): PendingVideoProjectMutation {
  return {
    projectId: "project-1",
    batch: {
      workspace_id: "workspace-1",
      mutation_id: id,
      base_revision: 1,
      device_id: "phone-a",
      operations: [
        { kind: "set", target: "clip:one", path: "/timeline/items/0/label", value: "Cut" },
      ],
    },
    queuedAt: 1,
    attempts: 0,
  };
}

describe("portable Video Project contract", () => {
  it("removes filesystem handles and device view state at every depth", () => {
    const portable = portableVideoProjectDocument({
      id: "project-1",
      rootFolderHandle: { opaque: true },
      timeline: { currentFrame: 18, zoomLevel: 2, items: [{ id: "clip-1", panelLayout: "wide" }] },
    });
    expect(portable).toEqual({ id: "project-1", timeline: { items: [{ id: "clip-1" }] } });
  });

  it("classifies only overlapping stable targets as conflicts", () => {
    expect(overlappingTargets(mutation("one").batch, ["track:two"])).toEqual([]);
    expect(overlappingTargets(mutation("one").batch, ["clip:one", "track:two"])).toEqual([
      "clip:one",
    ]);
  });

  it("keeps failed offline work, retries in order, and never redelivers settled mutations", async () => {
    let entries: PendingVideoProjectMutation[] = [];
    const storage = {
      load: async () => structuredClone(entries),
      save: async (next: PendingVideoProjectMutation[]) => {
        entries = structuredClone(next);
      },
    };
    const outbox = new VideoProjectMutationOutbox(storage);
    await outbox.enqueue(mutation("one"));
    await outbox.enqueue(mutation("one"));
    await outbox.enqueue(mutation("two"));

    const offline = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
    await expect(outbox.drain(offline)).rejects.toThrow("offline");
    expect(entries.map((entry) => [entry.batch.mutation_id, entry.attempts])).toEqual([
      ["one", 1],
      ["two", 0],
    ]);

    const online = vi.fn(async (entry: PendingVideoProjectMutation) => ({
      outcome: "applied" as const,
      revision: entry.batch.base_revision + 1,
    }));
    await expect(outbox.drain(online)).resolves.toEqual([
      { outcome: "applied", revision: 2 },
      { outcome: "applied", revision: 3 },
    ]);
    expect(entries).toEqual([]);
    expect(online).toHaveBeenCalledTimes(2);
    expect(online.mock.calls[1]?.[0].batch.base_revision).toBe(2);
  });
});

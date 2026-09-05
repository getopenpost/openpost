import { describe, expect, it, vi } from "vitest";
import {
  createCapturedVideoProjectDocument,
  overlappingTargets,
  portableVideoProjectDocument,
  videoProjectMutationOperations,
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
        {
          kind: "set",
          target: "clip:one",
          path: "/timeline/items/0/label",
          value: "Cut",
        },
      ],
    },
    queuedAt: 1,
    attempts: 0,
  };
}

describe("portable Video Project contract", () => {
  it("creates a web-editable timeline clip from a prepared mobile capture", () => {
    const document = createCapturedVideoProjectDocument({
      id: "capture-1",
      name: "Launch clip",
      fileName: "launch.mp4",
      durationSeconds: 12,
      width: 1920,
      height: 1080,
      preparation: {
        source_range: { start_seconds: 2, end_seconds: 8 },
        crop: { x: 0.2, y: 0, width: 0.6, height: 1 },
        rotation: 90,
        gain: 0.5,
        muted: false,
        cover_frame_seconds: 3,
      },
      createdAt: 100,
    });
    expect(document.timeline.items).toEqual([
      expect.objectContaining({
        mediaId: "capture-1",
        trackId: "track-video-main",
        durationInFrames: 180,
        sourceStart: 60,
        sourceEnd: 240,
        volume: 0.5,
        crop: { top: 0, right: 0.2, bottom: 0, left: 0.2 },
        transform: expect.objectContaining({ rotation: 90 }),
      }),
    ]);
    expect(document.thumbnailId).toBe("capture-1");
  });

  it("removes filesystem handles and device view state at every depth", () => {
    const portable = portableVideoProjectDocument({
      id: "project-1",
      rootFolderHandle: { opaque: true },
      timeline: {
        currentFrame: 18,
        zoomLevel: 2,
        items: [{ id: "clip-1", panelLayout: "wide" }],
      },
    });
    expect(portable).toEqual({
      id: "project-1",
      timeline: { items: [{ id: "clip-1" }] },
    });
  });

  it("classifies only overlapping stable targets as conflicts", () => {
    expect(overlappingTargets(mutation("one").batch, ["track:two"])).toEqual([]);
    expect(overlappingTargets(mutation("one").batch, ["clip:one", "track:two"])).toEqual([
      "clip:one",
    ]);
  });

  it("splits independent timeline property edits into stable mutation targets", () => {
    const previous = {
      id: "project-1",
      name: "Launch",
      timeline: {
        currentFrame: 10,
        tracks: [{ id: "video", name: "Video", muted: false }],
        items: [
          { id: "title", type: "text", text: "Original", from: 0 },
          { id: "clip", type: "video", durationInFrames: 60, from: 0 },
        ],
      },
    };
    const next = structuredClone(previous);
    next.timeline.currentFrame = 99;
    next.timeline.items[0]!.text = "Desktop title";
    next.timeline.items[1]!.durationInFrames = 120;

    expect(videoProjectMutationOperations(previous, next)).toEqual([
      {
        kind: "set",
        target: "item:title.text",
        path: "/timeline/items/0/text",
        value: "Desktop title",
      },
      {
        kind: "set",
        target: "item:clip.durationInFrames",
        path: "/timeline/items/1/durationInFrames",
        value: 120,
      },
    ]);
  });

  it("treats timeline membership and ordering as one shared region", () => {
    const previous = {
      id: "project-1",
      timeline: { items: [{ id: "one", text: "One" }] },
    };
    const next = {
      id: "project-1",
      timeline: {
        items: [
          { id: "one", text: "One" },
          { id: "two", text: "Two" },
        ],
      },
    };

    expect(videoProjectMutationOperations(previous, next)).toEqual([
      {
        kind: "set",
        target: "timeline:items",
        path: "/timeline/items",
        value: next.timeline.items,
      },
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

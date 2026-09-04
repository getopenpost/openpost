import { describe, expect, it } from "vitest";
import {
  analyticsQueryKeys,
  imageEditorQueryKeys,
  inboxQueryKeys,
  mediaQueryKeys,
  notificationQueryKeys,
  openPostQueryKeys,
  promptQueryKeys,
  schedulingQueryKeys,
  voiceProfileQueryKeys,
} from "./index";

// Every Workspace-scoped key family must partition by Workspace: a cache entry
// written for one Workspace must never satisfy a read for another. Each family
// below owns its own key factory, so each factory is exercised once; a dropped
// workspace segment in any one of them would leak cross-workspace data.
describe("workspace key partitioning", () => {
  it("keeps every workspace-scoped key family partitioned by workspace", () => {
    const families: Array<{ name: string; a: unknown; b: unknown }> = [
      {
        name: "media",
        a: mediaQueryKeys.lists("workspace-a"),
        b: mediaQueryKeys.lists("workspace-b"),
      },
      {
        name: "media metadata",
        a: mediaQueryKeys.metadata("workspace-a", ["media-1"]),
        b: mediaQueryKeys.metadata("workspace-b", ["media-1"]),
      },
      {
        name: "image-editor",
        a: imageEditorQueryKeys.designs("workspace-a"),
        b: imageEditorQueryKeys.designs("workspace-b"),
      },
      {
        name: "inbox engagement",
        a: inboxQueryKeys.engagementRoot("workspace-a"),
        b: inboxQueryKeys.engagementRoot("workspace-b"),
      },
      {
        name: "inbox messages",
        a: inboxQueryKeys.messages("workspace-a", "conversation-1", {
          limit: 20,
        }),
        b: inboxQueryKeys.messages("workspace-b", "conversation-1", {
          limit: 20,
        }),
      },
      {
        name: "notifications",
        a: notificationQueryKeys.inbox("workspace-a", 20),
        b: notificationQueryKeys.inbox("workspace-b", 20),
      },
      {
        name: "queue reminders",
        a: notificationQueryKeys.queueReminders("workspace-a"),
        b: notificationQueryKeys.queueReminders("workspace-b"),
      },
      {
        name: "voice profiles",
        a: voiceProfileQueryKeys.list("workspace-a"),
        b: voiceProfileQueryKeys.list("workspace-b"),
      },
      {
        name: "analytics",
        a: analyticsQueryKeys.all("workspace-a"),
        b: analyticsQueryKeys.all("workspace-b"),
      },
      {
        name: "scheduling",
        a: schedulingQueryKeys.publicationLists("workspace-a"),
        b: schedulingQueryKeys.publicationLists("workspace-b"),
      },
      {
        name: "prompts",
        a: promptQueryKeys.lists("workspace-a"),
        b: promptQueryKeys.lists("workspace-b"),
      },
    ];
    for (const family of families) {
      expect(family.a, `${family.name} leaks across workspaces`).not.toEqual(family.b);
    }
  });

  it("treats an empty activity cursor as no cursor", () => {
    expect(
      openPostQueryKeys.publications.activity("workspace-1", "scheduled", {
        limit: 40,
      }),
    ).toEqual(
      openPostQueryKeys.publications.activity("workspace-1", "scheduled", {
        limit: 40,
        cursor: "",
      }),
    );
  });
});

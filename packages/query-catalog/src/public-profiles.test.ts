import { QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import { publicProfileQueryKeys, publicProfileQueryOptions, type PublicProfile } from "./index";

describe("public profile query catalogue", () => {
  it("normalizes the username in the key and forwards cancellation", async () => {
    const profile = { username: "founder" } as PublicProfile;
    const getPublicProfile = vi.fn(async () => profile);
    const options = publicProfileQueryOptions({ getPublicProfile }, "  @Founder  ");
    const client = new QueryClient();

    await expect(client.fetchQuery(options)).resolves.toBe(profile);
    expect(publicProfileQueryKeys.detail("  @Founder  ")).toEqual([
      "openpost",
      "v1",
      "public-profile",
      "founder",
    ]);
    expect(publicProfileQueryKeys.all()).toEqual(["openpost", "v1", "public-profile"]);
    expect(publicProfileQueryKeys.detail("FOUNDER")).toEqual(
      publicProfileQueryKeys.detail("@founder"),
    );
    expect(getPublicProfile).toHaveBeenCalledWith("founder", expect.any(AbortSignal));
  });
});

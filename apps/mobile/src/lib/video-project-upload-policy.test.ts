import { describe, expect, it } from "bun:test";
import { videoProjectUploadAvailability } from "./video-project-upload-policy";

describe("Video Project upload policy", () => {
  it("waits offline and on cellular unless the user opts in", () => {
    expect(
      videoProjectUploadAvailability(
        { type: "WIFI", isConnected: false, isInternetReachable: false },
        true,
      ),
    ).toBe("offline");
    expect(
      videoProjectUploadAvailability(
        { type: "CELLULAR", isConnected: true, isInternetReachable: true },
        false,
      ),
    ).toBe("wifi_required");
    expect(
      videoProjectUploadAvailability(
        { type: "CELLULAR", isConnected: true, isInternetReachable: true },
        true,
      ),
    ).toBe("allowed");
    expect(
      videoProjectUploadAvailability(
        { type: "WIFI", isConnected: true, isInternetReachable: true },
        false,
      ),
    ).toBe("allowed");
  });
});

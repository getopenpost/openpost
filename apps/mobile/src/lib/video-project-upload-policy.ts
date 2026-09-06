export type VideoProjectNetworkState = {
  type?: string;
  isConnected?: boolean;
  isInternetReachable?: boolean;
};

export type VideoProjectUploadAvailability = "allowed" | "offline" | "wifi_required";

export function videoProjectUploadAvailability(
  network: VideoProjectNetworkState,
  allowCellular: boolean,
): VideoProjectUploadAvailability {
  if (network.isConnected !== true || network.isInternetReachable === false) return "offline";
  if (network.type === "CELLULAR" && !allowCellular) return "wifi_required";
  return "allowed";
}

import type { SymbolViewProps } from "expo-symbols";

type PlatformSymbolName = Exclude<SymbolViewProps["name"], string>;

export const NATIVE_PROTECTED_ICON_ROLES = [
  "camera",
  "download",
  "error",
  "gallery",
  "image",
  "info",
  "loading",
  "pause",
  "play",
  "success",
  "upload",
  "video",
  "warning",
] as const;
export type NativeProtectedIconRole = (typeof NATIVE_PROTECTED_ICON_ROLES)[number];

const PROTECTED_SYMBOLS: Readonly<Record<NativeProtectedIconRole, PlatformSymbolName>> = {
  camera: { ios: "camera.fill", android: "photo_camera" },
  download: { ios: "arrow.down.doc", android: "download" },
  error: { ios: "exclamationmark.octagon.fill", android: "report" },
  gallery: { ios: "photo.on.rectangle.angled", android: "photo_library" },
  image: { ios: "photo.fill", android: "image" },
  info: { ios: "info.circle.fill", android: "info" },
  loading: { ios: "arrow.triangle.2.circlepath", android: "progress_activity" },
  pause: { ios: "pause.fill", android: "pause" },
  play: { ios: "play.fill", android: "play_arrow" },
  success: { ios: "checkmark.circle.fill", android: "check_circle" },
  upload: { ios: "arrow.up.doc", android: "upload" },
  video: { ios: "video.fill", android: "video_library" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning" },
};

export function resolveNativeProtectedIcon(role: NativeProtectedIconRole): PlatformSymbolName {
  return PROTECTED_SYMBOLS[role];
}

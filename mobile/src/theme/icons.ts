import type { SymbolViewProps } from "expo-symbols";

import { BUILTIN_ICON_ROLE_MAPS } from "./builtins";
import {
  NATIVE_ICON_ROLES,
  type NativeIconPackId,
  type NativeIconRole,
  type NativeThemeManifest,
} from "./contract";

type PlatformSymbolName = Exclude<SymbolViewProps["name"], string>;

export interface NativeThemeSymbolSelection {
  readonly name: PlatformSymbolName;
  readonly packId: NativeIconPackId;
  readonly requestedRole: NativeIconRole;
  readonly resolvedRole: NativeIconRole;
  readonly sourceGlyphId: string;
  readonly type: NonNullable<SymbolViewProps["type"]>;
}

const PLATFORM_SYMBOLS: Readonly<Record<NativeIconRole, PlatformSymbolName>> = {
  add: { ios: "plus", android: "add" },
  back: { ios: "arrow.left", android: "arrow_back" },
  next: { ios: "arrow.right", android: "arrow_forward" },
  disclosure: { ios: "chevron.right", android: "chevron_right" },
  close: { ios: "xmark", android: "close" },
  menu: { ios: "line.3.horizontal", android: "menu" },
  more: { ios: "ellipsis", android: "more_vert" },
  search: { ios: "magnifyingglass", android: "search" },
  settings: { ios: "gearshape", android: "settings" },
  edit: { ios: "pencil", android: "edit" },
  delete: { ios: "trash", android: "delete" },
  check: { ios: "checkmark", android: "check" },
  retry: { ios: "arrow.clockwise", android: "refresh" },
  calendar: { ios: "calendar", android: "calendar_month" },
  queue: { ios: "clock", android: "upcoming" },
  drafts: { ios: "square.and.pencil", android: "edit_note" },
  workspace: { ios: "square.grid.2x2", android: "grid_view" },
  link: { ios: "arrow.up.right.square", android: "open_in_new" },
  upload: { ios: "arrow.up.doc", android: "upload" },
  download: { ios: "arrow.down.doc", android: "download" },
  image: { ios: "photo", android: "image" },
  video: { ios: "play.rectangle", android: "video_library" },
  account: { ios: "person.crop.circle", android: "account_circle" },
  notification: { ios: "bell", android: "notifications" },
  undo: { ios: "arrow.uturn.backward", android: "undo" },
  redo: { ios: "arrow.uturn.forward", android: "redo" },
};

export function resolveNativeThemeSymbol(
  manifest: NativeThemeManifest,
  requestedRole: NativeIconRole,
): NativeThemeSymbolSelection {
  const { packId, roles } = manifest.iconography;
  const sourceGlyphId = roles[requestedRole];
  const resolvedRole = roleForSourceGlyph(packId, sourceGlyphId) ?? requestedRole;
  return {
    name: PLATFORM_SYMBOLS[resolvedRole],
    packId,
    requestedRole,
    resolvedRole,
    sourceGlyphId,
    type: packId === "heroicons-solid" ? "hierarchical" : "monochrome",
  };
}

function roleForSourceGlyph(
  packId: NativeIconPackId,
  sourceGlyphId: string,
): NativeIconRole | null {
  const pack = BUILTIN_ICON_ROLE_MAPS[packId];
  return NATIVE_ICON_ROLES.find((role) => pack[role] === sourceGlyphId) ?? null;
}

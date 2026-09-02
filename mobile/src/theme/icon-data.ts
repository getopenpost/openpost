import type { NativeIconPackId, NativeIconRole } from "./contract";

export interface NativeThemeIconData {
  readonly body: string;
  readonly sourceGlyphId: string;
  readonly viewBox: string;
}

export interface NativeThemeIconPack {
  readonly id: NativeIconPackId;
  readonly icons: Readonly<Record<NativeIconRole, NativeThemeIconData>>;
}

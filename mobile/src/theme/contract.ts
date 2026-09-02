export const NATIVE_THEME_CONTRACT_VERSION = 1 as const;

export type NativeThemeScheme = "light" | "dark";
export type NativeThemePreference = NativeThemeScheme | "system";

export const ACTION_INTENTS = [
  "focal",
  "primary",
  "ordinary",
  "quiet",
  "destructive",
  "link",
] as const;
export type NativeActionIntent = (typeof ACTION_INTENTS)[number];

export const NATIVE_ICON_ROLES = [
  "add",
  "back",
  "next",
  "disclosure",
  "close",
  "menu",
  "more",
  "search",
  "settings",
  "edit",
  "delete",
  "check",
  "retry",
  "calendar",
  "queue",
  "drafts",
  "workspace",
  "link",
  "upload",
  "download",
  "image",
  "video",
  "account",
  "notification",
  "warning",
  "error",
  "success",
  "play",
  "pause",
  "undo",
  "redo",
] as const;
export type NativeIconRole = (typeof NATIVE_ICON_ROLES)[number];
export type NativeIconPackId =
  | "lucide"
  | "heroicons-outline"
  | "heroicons-solid"
  | "phosphor"
  | "tabler";

export const PUBLICATION_STATUSES = [
  "draft",
  "ready",
  "scheduled",
  "publishing",
  "published",
  "failed",
] as const;
export type NativePublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export type NativeFontWeight = "400" | "500" | "600" | "700" | "800";

export interface NativeTextRole {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly fontWeight: NativeFontWeight;
  readonly letterSpacing: number;
  readonly lineHeight: number;
}

export interface NativeColorRoles {
  readonly background: string;
  readonly surface: string;
  readonly surfaceContainer: string;
  readonly surfaceContainerHigh: string;
  readonly onSurface: string;
  readonly onSurfaceVariant: string;
  readonly outline: string;
  readonly outlineVariant: string;
  readonly primary: string;
  readonly onPrimary: string;
  readonly primaryContainer: string;
  readonly onPrimaryContainer: string;
  readonly secondaryContainer: string;
  readonly onSecondaryContainer: string;
  readonly error: string;
  readonly onError: string;
  readonly errorContainer: string;
  readonly onErrorContainer: string;
  readonly success: string;
  readonly onSuccess: string;
  readonly warning: string;
  readonly onWarning: string;
  readonly link: string;
  readonly focus: string;
  readonly scrim: string;
  readonly shadow: string;
  readonly status: Readonly<Record<NativePublicationStatus, string>>;
}

export interface NativeActionStyle {
  readonly container: string;
  readonly content: string;
  readonly border: string;
  readonly pressedContainer: string;
  readonly depthColor: string;
  readonly borderWidth: number;
  readonly depth: number;
  readonly disabledOpacity: number;
  readonly underline: boolean;
}

export interface NativeProtectedEditorRoles {
  readonly canvas: string;
  readonly canvasGrid: string;
  readonly canvasSelection: string;
  readonly canvasSelectionText: string;
  readonly transparencyLight: string;
  readonly transparencyDark: string;
  readonly timeline: string;
  readonly timelineTrack: string;
  readonly timelinePlayhead: string;
  readonly waveform: string;
  readonly handle: string;
  readonly safeArea: string;
  readonly mediaScrim: string;
}

export interface NativeThemeManifest {
  readonly id: string;
  readonly familyId: string;
  readonly displayName: string;
  readonly scheme: NativeThemeScheme;
  readonly colors: NativeColorRoles;
  readonly actions: Readonly<Record<NativeActionIntent, NativeActionStyle>>;
  readonly editor: NativeProtectedEditorRoles;
  readonly typography: Readonly<{
    displayLarge: NativeTextRole;
    headlineLarge: NativeTextRole;
    titleLarge: NativeTextRole;
    titleMedium: NativeTextRole;
    bodyLarge: NativeTextRole;
    bodyMedium: NativeTextRole;
    bodySmall: NativeTextRole;
    labelLarge: NativeTextRole;
    labelMedium: NativeTextRole;
  }>;
  readonly shape: Readonly<{
    extraSmall: number;
    small: number;
    medium: number;
    large: number;
    extraLarge: number;
    full: number;
  }>;
  readonly spacing: Readonly<{
    extraSmall: number;
    small: number;
    medium: number;
    large: number;
    extraLarge: number;
    doubleExtraLarge: number;
  }>;
  readonly motion: Readonly<{
    quickMs: number;
    standardMs: number;
    emphasizedMs: number;
  }>;
  readonly decoration: Readonly<{
    celebration: readonly string[];
  }>;
  readonly iconography: Readonly<{
    packId: NativeIconPackId;
    roles: Readonly<Record<NativeIconRole, string>>;
  }>;
}

export interface NativeThemeFamily {
  readonly id: string;
  readonly displayName: string;
  readonly builtinVersion: number;
  readonly supportedSchemes: readonly NativeThemeScheme[];
  readonly manifests: Partial<Readonly<Record<NativeThemeScheme, NativeThemeManifest>>>;
}

/**
 * Immutable hand-off from the future query adapter into the native renderer.
 * The adapter owns API conversion. This runtime never fetches or reads query state.
 */
export interface NativeResolvedThemeContract {
  readonly contractVersion: typeof NATIVE_THEME_CONTRACT_VERSION;
  readonly identity: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly themeId: string;
  readonly displayName: string;
  readonly revision: string;
  readonly supportedSchemes: readonly NativeThemeScheme[];
  readonly manifests: Partial<Readonly<Record<NativeThemeScheme, NativeThemeManifest>>>;
}

export type NativeThemeFallbackReason =
  | "contract-unavailable"
  | "invalid-contract"
  | "stale-contract"
  | "unsupported-scheme";

export interface NativeThemeSnapshot {
  readonly activationKey: string;
  readonly workspaceId: string | null;
  readonly preference: NativeThemePreference;
  readonly effectiveScheme: NativeThemeScheme;
  readonly familyId: string;
  readonly displayName: string;
  readonly manifest: NativeThemeManifest;
  readonly source:
    | Readonly<{ kind: "contract"; identity: string; revision: string }>
    | Readonly<{ kind: "fallback"; reason: NativeThemeFallbackReason }>;
}

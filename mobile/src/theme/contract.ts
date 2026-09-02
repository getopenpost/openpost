export const NATIVE_THEME_CONTRACT_VERSION = 2 as const;

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

export const NATIVE_MIN_TEXT_SIZE = 11;

export type NativeFontWeight =
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

export interface NativeTextRole {
  readonly fontFamily?: string;
  readonly fontResourceId?: string;
  readonly fontSize: number;
  readonly fontWeight: NativeFontWeight;
  readonly letterSpacing: number;
  readonly lineHeight: number;
}

export type NativeThemeAssetSlot =
  | "background-texture"
  | "sidebar-decoration"
  | "header-decoration"
  | "empty-state-illustration"
  | "loading-illustration";

export interface NativeThemeFontResource {
  readonly id: string;
  readonly family: string;
  readonly sourceUrl: string;
  readonly format: "woff2";
  readonly nativeDerivative: Readonly<{
    readonly sourceUrl: string;
    readonly format: "ttf" | "otf";
    /** SHA-256 of the generated native font bytes. */
    readonly identity: string;
  }>;
  readonly weight: number;
  readonly style: "normal" | "italic";
  readonly display: "swap" | "fallback" | "optional";
}

export interface NativeThemeAssetResource {
  readonly id: string;
  readonly slot: NativeThemeAssetSlot;
  readonly sourceUrl: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif";
  readonly alt?: string;
}

export interface NativeThemeResources {
  /** Stable identity of the exact descriptors that must be staged together. */
  readonly identity: string;
  readonly fonts: readonly NativeThemeFontResource[];
  readonly assets: readonly NativeThemeAssetResource[];
}

/**
 * Query-side resource loaders publish this only after every descriptor has a
 * local, decoded resource. Font loaders must authenticate the derivative byte
 * request, verify its identity, and stage it as a file URI before Expo Font
 * receives it. Protected API URLs are never valid staged resources. The
 * renderer rejects partial and stale sets.
 */
export interface NativeStagedThemeResources {
  readonly contractIdentity: string;
  readonly resourceIdentity: string;
  readonly workspaceId: string;
  readonly fonts: Readonly<
    Record<
      string,
      Readonly<{
        family: string;
        uri: string;
        format: "ttf" | "otf";
        derivativeIdentity: string;
      }>
    >
  >;
  readonly assets: Readonly<Record<string, string>>;
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
  readonly workspaceId: string;
  readonly themeId: string;
  readonly displayName: string;
  readonly revision: string;
  readonly resolutionSource: "builtin" | "organization" | "fallback";
  readonly fallbackReason?: string;
  readonly supportedSchemes: readonly NativeThemeScheme[];
  readonly manifests: Partial<Readonly<Record<NativeThemeScheme, NativeThemeManifest>>>;
  readonly resources: NativeThemeResources;
}

export type NativeThemeFallbackReason =
  | "contract-unavailable"
  | "invalid-contract"
  | "stale-contract"
  | "unsupported-scheme"
  | "resources-unavailable";

export interface NativeThemeSnapshot {
  readonly activationKey: string;
  readonly workspaceId: string | null;
  readonly preference: NativeThemePreference;
  readonly effectiveScheme: NativeThemeScheme;
  readonly familyId: string;
  readonly displayName: string;
  readonly manifest: NativeThemeManifest;
  readonly resources: NativeStagedThemeResources | null;
  readonly source:
    | Readonly<{
        kind: "contract";
        identity: string;
        revision: string;
        resolutionSource: "builtin" | "organization" | "fallback";
        fallbackReason?: string;
      }>
    | Readonly<{ kind: "fallback"; reason: NativeThemeFallbackReason }>;
}

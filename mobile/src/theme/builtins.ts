import {
  NATIVE_THEME_CONTRACT_VERSION,
  type NativeActionStyle,
  type NativeColorRoles,
  type NativeIconPackId,
  type NativeProtectedEditorRoles,
  type NativeResolvedThemeContract,
  type NativeTextRole,
  type NativeThemeFamily,
  type NativeThemeManifest,
  type NativeThemeScheme,
} from "./contract";
import { deepFreeze, withAlpha } from "./freeze";
import { BUILTIN_ICON_ROLE_MAPS } from "./icon-packs";

export { BUILTIN_ICON_ROLE_MAPS } from "./icon-packs";
export { validateNativeThemeManifest } from "./validation";

export const BUILTIN_THEME_IDS = [
  "workshop",
  "studio",
  "notebook",
  "playroom",
  "cloud-garden",
  "study-hall",
  "corkboard",
  "midnight",
] as const;
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

type Palette = NativeColorRoles;

interface NativeThemePersonality {
  readonly typography: NativeThemeManifest["typography"];
  readonly shape: NativeThemeManifest["shape"];
  readonly spacing: NativeThemeManifest["spacing"];
  readonly motion: NativeThemeManifest["motion"];
  readonly actions: Readonly<
    Record<"focal" | "primary" | "ordinary", Readonly<{ borderWidth: number; depth: number }>>
  >;
}

const ICON_PACK_BY_FAMILY: Readonly<Record<BuiltinThemeId, NativeIconPackId>> = {
  workshop: "lucide",
  studio: "heroicons-outline",
  notebook: "phosphor",
  playroom: "heroicons-solid",
  "cloud-garden": "tabler",
  "study-hall": "lucide",
  corkboard: "phosphor",
  midnight: "tabler",
};

const BUILTIN_PERSONALITIES = deepFreeze({
  workshop: {
    typography: {
      displayLarge: textRole(57, 64, "400", -1.4),
      headlineLarge: textRole(32, 40, "600", -0.5),
      titleLarge: textRole(24, 30, "700", -0.35),
      titleMedium: textRole(18, 24, "600", -0.1),
      bodyLarge: textRole(16, 24, "400", 0.1),
      bodyMedium: textRole(14, 20, "400", 0.15),
      bodySmall: textRole(12, 16, "400", 0.2),
      labelLarge: textRole(16, 20, "600", 0.1),
      labelMedium: textRole(12, 16, "600", 0.25),
    },
    shape: shapeScale(6, 10, 14, 18, 26),
    spacing: spacingScale(4, 8, 12, 16, 24, 32),
    motion: motionScale(120, 220, 360),
    actions: {
      focal: { borderWidth: 1, depth: 2 },
      primary: { borderWidth: 0, depth: 0 },
      ordinary: { borderWidth: 1, depth: 0 },
    },
  },
  studio: {
    typography: {
      displayLarge: textRole(52, 58, "500", -1.1),
      headlineLarge: textRole(30, 36, "600", -0.45),
      titleLarge: textRole(22, 28, "600", -0.3),
      titleMedium: textRole(17, 22, "600", -0.1),
      bodyLarge: textRole(16, 23, "400", 0),
      bodyMedium: textRole(14, 20, "400", 0.1),
      bodySmall: textRole(12, 16, "400", 0.15),
      labelLarge: textRole(15, 20, "600", 0.05),
      labelMedium: textRole(12, 16, "600", 0.2),
    },
    shape: shapeScale(5, 9, 12, 15, 22),
    spacing: spacingScale(4, 8, 12, 16, 24, 32),
    motion: motionScale(100, 180, 300),
    actions: {
      focal: { borderWidth: 1, depth: 1 },
      primary: { borderWidth: 0, depth: 0 },
      ordinary: { borderWidth: 0, depth: 0 },
    },
  },
  notebook: {
    typography: {
      displayLarge: textRole(50, 58, "500", -0.4),
      headlineLarge: textRole(31, 39, "600", -0.2),
      titleLarge: textRole(23, 30, "600", -0.1),
      titleMedium: textRole(18, 25, "600", 0),
      bodyLarge: textRole(17, 27, "400", 0),
      bodyMedium: textRole(15, 24, "400", 0.05),
      bodySmall: textRole(12, 19, "400", 0.1),
      labelLarge: textRole(15, 21, "600", 0.2),
      labelMedium: textRole(12, 17, "600", 0.3),
    },
    shape: shapeScale(3, 6, 10, 14, 20),
    spacing: spacingScale(4, 9, 13, 18, 28, 40),
    motion: motionScale(120, 240, 400),
    actions: {
      focal: { borderWidth: 1, depth: 1 },
      primary: { borderWidth: 1, depth: 0 },
      ordinary: { borderWidth: 1, depth: 0 },
    },
  },
  playroom: {
    typography: {
      displayLarge: textRole(56, 60, "800", -0.8),
      headlineLarge: textRole(34, 40, "800", -0.35),
      titleLarge: textRole(25, 30, "800", -0.2),
      titleMedium: textRole(19, 24, "700", 0),
      bodyLarge: textRole(16, 24, "500", 0.1),
      bodyMedium: textRole(14, 21, "500", 0.15),
      bodySmall: textRole(12, 17, "500", 0.2),
      labelLarge: textRole(16, 20, "700", 0.2),
      labelMedium: textRole(12, 16, "700", 0.3),
    },
    shape: shapeScale(8, 12, 16, 22, 30),
    spacing: spacingScale(4, 10, 14, 20, 28, 40),
    motion: motionScale(140, 260, 420),
    actions: {
      focal: { borderWidth: 2, depth: 4 },
      primary: { borderWidth: 0, depth: 2 },
      ordinary: { borderWidth: 0, depth: 1 },
    },
  },
  "cloud-garden": {
    typography: {
      displayLarge: textRole(54, 62, "500", -1),
      headlineLarge: textRole(31, 39, "600", -0.25),
      titleLarge: textRole(23, 29, "600", -0.15),
      titleMedium: textRole(18, 24, "600", 0),
      bodyLarge: textRole(16, 25, "400", 0.1),
      bodyMedium: textRole(14, 22, "400", 0.15),
      bodySmall: textRole(12, 18, "400", 0.2),
      labelLarge: textRole(15, 21, "600", 0.15),
      labelMedium: textRole(12, 17, "600", 0.25),
    },
    shape: shapeScale(8, 12, 16, 20, 28),
    spacing: spacingScale(4, 9, 13, 18, 28, 40),
    motion: motionScale(160, 300, 480),
    actions: {
      focal: { borderWidth: 1, depth: 3 },
      primary: { borderWidth: 0, depth: 1 },
      ordinary: { borderWidth: 0, depth: 2 },
    },
  },
  "study-hall": {
    typography: {
      displayLarge: textRole(48, 54, "600", -0.8),
      headlineLarge: textRole(29, 34, "600", -0.3),
      titleLarge: textRole(21, 26, "700", -0.2),
      titleMedium: textRole(17, 22, "600", 0),
      bodyLarge: textRole(15, 21, "400", 0.05),
      bodyMedium: textRole(13, 18, "400", 0.1),
      bodySmall: textRole(11, 15, "400", 0.15),
      labelLarge: textRole(14, 18, "700", 0.2),
      labelMedium: textRole(11, 15, "700", 0.3),
    },
    shape: shapeScale(4, 8, 10, 12, 18),
    spacing: spacingScale(3, 6, 10, 14, 20, 28),
    motion: motionScale(90, 170, 280),
    actions: {
      focal: { borderWidth: 2, depth: 0 },
      primary: { borderWidth: 2, depth: 0 },
      ordinary: { borderWidth: 1, depth: 0 },
    },
  },
  corkboard: {
    typography: {
      displayLarge: textRole(50, 56, "700", -0.7),
      headlineLarge: textRole(30, 36, "700", -0.25),
      titleLarge: textRole(22, 28, "700", -0.1),
      titleMedium: textRole(18, 23, "700", 0),
      bodyLarge: textRole(16, 24, "400", 0.1),
      bodyMedium: textRole(14, 20, "400", 0.15),
      bodySmall: textRole(11, 16, "400", 0.2),
      labelLarge: textRole(15, 19, "700", 0.25),
      labelMedium: textRole(11, 15, "700", 0.35),
    },
    shape: shapeScale(3, 6, 9, 12, 18),
    spacing: spacingScale(4, 7, 11, 15, 22, 30),
    motion: motionScale(130, 230, 380),
    actions: {
      focal: { borderWidth: 2, depth: 5 },
      primary: { borderWidth: 1, depth: 2 },
      ordinary: { borderWidth: 1, depth: 3 },
    },
  },
  midnight: {
    typography: {
      displayLarge: textRole(49, 54, "500", -1.2),
      headlineLarge: textRole(29, 34, "500", -0.7),
      titleLarge: textRole(21, 26, "600", -0.5),
      titleMedium: textRole(17, 21, "600", -0.25),
      bodyLarge: textRole(15, 21, "400", 0.1),
      bodyMedium: textRole(13, 18, "400", 0.15),
      bodySmall: textRole(11, 15, "400", 0.25),
      labelLarge: textRole(14, 18, "600", 0.5),
      labelMedium: textRole(11, 15, "600", 0.55),
    },
    shape: shapeScale(2, 5, 8, 10, 16),
    spacing: spacingScale(3, 6, 9, 13, 20, 28),
    motion: motionScale(80, 140, 240),
    actions: {
      focal: { borderWidth: 1, depth: 2 },
      primary: { borderWidth: 1, depth: 0 },
      ordinary: { borderWidth: 1, depth: 0 },
    },
  },
} satisfies Record<BuiltinThemeId, NativeThemePersonality>);

const LIGHT_EDITOR_ROLES: NativeProtectedEditorRoles = deepFreeze({
  canvas: "#E9ECEF",
  canvasGrid: "#C6CBD1",
  canvasSelection: "#1467B0",
  canvasSelectionText: "#FFFFFF",
  transparencyLight: "#F8F9FA",
  transparencyDark: "#DDE1E5",
  timeline: "#20242A",
  timelineTrack: "#343A42",
  timelinePlayhead: "#FF4D67",
  waveform: "#8AC7FF",
  handle: "#FFFFFF",
  safeArea: "rgba(20, 103, 176, 0.18)",
  mediaScrim: "rgba(0, 0, 0, 0.62)",
});

const DARK_EDITOR_ROLES: NativeProtectedEditorRoles = deepFreeze({
  canvas: "#111418",
  canvasGrid: "#30363D",
  canvasSelection: "#71B7F1",
  canvasSelectionText: "#08131C",
  transparencyLight: "#30343A",
  transparencyDark: "#1E2227",
  timeline: "#0C0E11",
  timelineTrack: "#292E35",
  timelinePlayhead: "#FF6B7E",
  waveform: "#8AC7FF",
  handle: "#F7F9FB",
  safeArea: "rgba(113, 183, 241, 0.2)",
  mediaScrim: "rgba(0, 0, 0, 0.68)",
});

const WORKSHOP_LIGHT: Palette = palette({
  background: "#FAF8F5",
  surface: "#FFFFFF",
  surfaceContainer: "#F7F3EF",
  surfaceContainerHigh: "#F0EBE6",
  onSurface: "#302B28",
  onSurfaceVariant: "#675F5A",
  outline: "#817873",
  outlineVariant: "#E4DED8",
  primary: "#B74C05",
  onPrimary: "#FFFFFF",
  primaryContainer: "#F7E9DE",
  onPrimaryContainer: "#5A2100",
  secondaryContainer: "#ECE7E2",
  onSecondaryContainer: "#3D3733",
  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",
  success: "#376B51",
  onSuccess: "#FFFFFF",
  warning: "#795900",
  onWarning: "#FFFFFF",
  link: "#8C3A00",
  focus: "#B74C05",
  status: {
    draft: "#675F5A",
    ready: "#A94400",
    scheduled: "#795900",
    publishing: "#934000",
    published: "#376B51",
    failed: "#B3261E",
  },
});

const WORKSHOP_DARK: Palette = palette({
  background: "#171412",
  surface: "#211D1A",
  surfaceContainer: "#27221F",
  surfaceContainerHigh: "#302A26",
  onSurface: "#F3EFEB",
  onSurfaceVariant: "#C5BAB3",
  outline: "#988D86",
  outlineVariant: "#3A332F",
  primary: "#E9823A",
  onPrimary: "#2D1405",
  primaryContainer: "#4E2B17",
  onPrimaryContainer: "#FFDCC5",
  secondaryContainer: "#3A332F",
  onSecondaryContainer: "#EEE4DE",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
  success: "#8FCFAC",
  onSuccess: "#073823",
  warning: "#E6C25C",
  onWarning: "#3F2E00",
  link: "#FFB27E",
  focus: "#FF9A55",
  status: {
    draft: "#C5BAB3",
    ready: "#F09A5E",
    scheduled: "#E6C25C",
    publishing: "#FFB77B",
    published: "#8FCFAC",
    failed: "#FFB4AB",
  },
});

const STUDIO_LIGHT: Palette = palette({
  background: "#F7F9FC",
  surface: "#FFFFFF",
  surfaceContainer: "#F1F4F9",
  surfaceContainerHigh: "#E9EEF6",
  onSurface: "#172033",
  onSurfaceVariant: "#566176",
  outline: "#748096",
  outlineVariant: "#DCE2EC",
  primary: "#1457D9",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DCE5FF",
  onPrimaryContainer: "#001A43",
  secondaryContainer: "#E5EAF4",
  onSecondaryContainer: "#293247",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#236A46",
  onSuccess: "#FFFFFF",
  warning: "#795900",
  onWarning: "#FFFFFF",
  link: "#1457D9",
  focus: "#1457D9",
  status: statusSet("#566176", "#1457D9", "#795900", "#8A3E00", "#236A46", "#BA1A1A"),
});

const NOTEBOOK_LIGHT: Palette = palette({
  background: "#F8F1E6",
  surface: "#FFF9F0",
  surfaceContainer: "#F3E8D9",
  surfaceContainerHigh: "#EBDDCA",
  onSurface: "#362F28",
  onSurfaceVariant: "#655C53",
  outline: "#7B7166",
  outlineVariant: "#DCCFBE",
  primary: "#315C7A",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D7E9F5",
  onPrimaryContainer: "#0A354F",
  secondaryContainer: "#F2DFB4",
  onSecondaryContainer: "#493607",
  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",
  success: "#41654A",
  onSuccess: "#FFFFFF",
  warning: "#805600",
  onWarning: "#FFFFFF",
  link: "#315C7A",
  focus: "#315C7A",
  status: statusSet("#655C53", "#315C7A", "#805600", "#A3462A", "#41654A", "#B3261E"),
});

const PLAYROOM_LIGHT: Palette = palette({
  background: "#FFFDF8",
  surface: "#FFFFFF",
  surfaceContainer: "#F2F7EE",
  surfaceContainerHigh: "#E6F0E0",
  onSurface: "#1F2A23",
  onSurfaceVariant: "#526057",
  outline: "#66736A",
  outlineVariant: "#D5DED4",
  primary: "#1B7A3D",
  onPrimary: "#FFFFFF",
  primaryContainer: "#B9F2C6",
  onPrimaryContainer: "#00210B",
  secondaryContainer: "#D8E9FF",
  onSecondaryContainer: "#0A3053",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#1B7A3D",
  onSuccess: "#FFFFFF",
  warning: "#765A00",
  onWarning: "#FFFFFF",
  link: "#1467B0",
  focus: "#1467B0",
  status: statusSet("#526057", "#1467B0", "#765A00", "#A6401B", "#1B7A3D", "#BA1A1A"),
});

const CLOUD_GARDEN_LIGHT: Palette = palette({
  background: "#F3FCF7",
  surface: "#FFFFFF",
  surfaceContainer: "#EAF7F0",
  surfaceContainerHigh: "#DDF0E6",
  onSurface: "#19342A",
  onSurfaceVariant: "#50665C",
  outline: "#6C7D74",
  outlineVariant: "#CEE2D7",
  primary: "#116C4C",
  onPrimary: "#FFFFFF",
  primaryContainer: "#B5F1D2",
  onPrimaryContainer: "#002116",
  secondaryContainer: "#D8EADF",
  onSecondaryContainer: "#20372B",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#116C4C",
  onSuccess: "#FFFFFF",
  warning: "#715B00",
  onWarning: "#FFFFFF",
  link: "#0B5F78",
  focus: "#0A7A54",
  status: statusSet("#50665C", "#0B5F78", "#715B00", "#9B421D", "#116C4C", "#BA1A1A"),
});

const STUDY_HALL_LIGHT: Palette = palette({
  background: "#F5F7FF",
  surface: "#FFFFFF",
  surfaceContainer: "#EEF0FA",
  surfaceContainerHigh: "#E5E8F5",
  onSurface: "#252637",
  onSurfaceVariant: "#5C5E72",
  outline: "#77798D",
  outlineVariant: "#DDE0EE",
  primary: "#4655B8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DFE0FF",
  onPrimaryContainer: "#00105C",
  secondaryContainer: "#F5DFF1",
  onSecondaryContainer: "#45263F",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#386A4A",
  onSuccess: "#FFFFFF",
  warning: "#755A00",
  onWarning: "#FFFFFF",
  link: "#4655B8",
  focus: "#4655B8",
  status: statusSet("#5C5E72", "#4655B8", "#755A00", "#9B411B", "#386A4A", "#BA1A1A"),
});

const CORKBOARD_LIGHT: Palette = palette({
  background: "#F3E5CD",
  surface: "#FFF8EA",
  surfaceContainer: "#EAD9BC",
  surfaceContainerHigh: "#E0CCAA",
  onSurface: "#344733",
  onSurfaceVariant: "#5C6755",
  outline: "#737E69",
  outlineVariant: "#CFC1A8",
  primary: "#8D5700",
  onPrimary: "#FFFFFF",
  primaryContainer: "#FFDEA4",
  onPrimaryContainer: "#2D1900",
  secondaryContainer: "#DDE7D5",
  onSecondaryContainer: "#283425",
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#410002",
  success: "#466545",
  onSuccess: "#FFFFFF",
  warning: "#735C00",
  onWarning: "#FFFFFF",
  link: "#245A91",
  focus: "#245A91",
  status: statusSet("#5C6755", "#245A91", "#735C00", "#9D421D", "#466545", "#BA1A1A"),
});

const MIDNIGHT_DARK: Palette = palette({
  background: "#0D0F0D",
  surface: "#151815",
  surfaceContainer: "#1B1F1A",
  surfaceContainerHigh: "#242921",
  onSurface: "#F0F4E8",
  onSurfaceVariant: "#B8C0B0",
  outline: "#8A9382",
  outlineVariant: "#343B31",
  primary: "#B9E84A",
  onPrimary: "#1A2B00",
  primaryContainer: "#354D00",
  onPrimaryContainer: "#D2FF73",
  secondaryContainer: "#30382C",
  onSecondaryContainer: "#E0E8D8",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",
  success: "#9AD6A0",
  onSuccess: "#073913",
  warning: "#E3C45F",
  onWarning: "#3E3000",
  link: "#C3EA72",
  focus: "#B9E84A",
  status: statusSet("#B8C0B0", "#C3EA72", "#E3C45F", "#FFB77D", "#9AD6A0", "#FFB4AB"),
});

export const BUILTIN_THEME_FAMILIES: Readonly<Record<BuiltinThemeId, NativeThemeFamily>> =
  deepFreeze({
    workshop: family("workshop", "Workshop", {
      light: manifest("workshop", "Workshop", "light", WORKSHOP_LIGHT),
      dark: manifest("workshop", "Workshop", "dark", WORKSHOP_DARK),
    }),
    studio: family("studio", "Studio", {
      light: manifest("studio", "Studio", "light", STUDIO_LIGHT),
    }),
    notebook: family("notebook", "Notebook", {
      light: manifest("notebook", "Notebook", "light", NOTEBOOK_LIGHT, "#945F00"),
    }),
    playroom: family("playroom", "Playroom", {
      light: manifest("playroom", "Playroom", "light", PLAYROOM_LIGHT),
    }),
    "cloud-garden": family("cloud-garden", "Cloud Garden", {
      light: manifest("cloud-garden", "Cloud Garden", "light", CLOUD_GARDEN_LIGHT, "#173D32"),
    }),
    "study-hall": family("study-hall", "Study Hall", {
      light: manifest("study-hall", "Study Hall", "light", STUDY_HALL_LIGHT),
    }),
    corkboard: family("corkboard", "Corkboard", {
      light: manifest("corkboard", "Corkboard", "light", CORKBOARD_LIGHT),
    }),
    midnight: family("midnight", "Midnight", {
      dark: manifest("midnight", "Midnight", "dark", MIDNIGHT_DARK),
    }),
  });

export function builtinThemeForScheme(
  familyId: BuiltinThemeId,
  scheme: NativeThemeScheme,
): {
  family: NativeThemeFamily;
  manifest: NativeThemeManifest;
  fallbackReason: "unsupported-scheme" | null;
} {
  const family = BUILTIN_THEME_FAMILIES[familyId];
  const candidate = family.manifests[scheme];
  if (candidate) return { family, manifest: candidate, fallbackReason: null };

  const workshop = BUILTIN_THEME_FAMILIES.workshop;
  return {
    family: workshop,
    manifest: workshop.manifests[scheme]!,
    fallbackReason: "unsupported-scheme",
  };
}

export function createBuiltinThemeContract({
  familyId,
  identity,
  workspaceId,
}: {
  familyId: BuiltinThemeId;
  identity: string;
  workspaceId: string;
}): NativeResolvedThemeContract {
  const family = BUILTIN_THEME_FAMILIES[familyId];
  return deepFreeze({
    contractVersion: NATIVE_THEME_CONTRACT_VERSION,
    identity,
    workspaceId,
    themeId: family.id,
    displayName: family.displayName,
    revision: `builtin-${family.builtinVersion}`,
    resolutionSource: "builtin",
    supportedSchemes: family.supportedSchemes,
    manifests: family.manifests,
    resources: {
      identity: `${identity}:resources:[]`,
      fonts: [],
      assets: [],
    },
  });
}

function textRole(
  fontSize: number,
  lineHeight: number,
  fontWeight: NativeTextRole["fontWeight"],
  letterSpacing: number,
): NativeTextRole {
  return { fontSize, fontWeight, letterSpacing, lineHeight };
}

function shapeScale(
  extraSmall: number,
  small: number,
  medium: number,
  large: number,
  extraLarge: number,
): NativeThemeManifest["shape"] {
  return { extraSmall, small, medium, large, extraLarge, full: 999 };
}

function spacingScale(
  extraSmall: number,
  small: number,
  medium: number,
  large: number,
  extraLarge: number,
  doubleExtraLarge: number,
): NativeThemeManifest["spacing"] {
  return { extraSmall, small, medium, large, extraLarge, doubleExtraLarge };
}

function motionScale(
  quickMs: number,
  standardMs: number,
  emphasizedMs: number,
): NativeThemeManifest["motion"] {
  return { quickMs, standardMs, emphasizedMs };
}

function palette(
  value: Omit<NativeColorRoles, "scrim" | "shadow"> &
    Partial<Pick<NativeColorRoles, "scrim" | "shadow">>,
): NativeColorRoles {
  return deepFreeze({
    ...value,
    scrim: value.scrim ?? "rgba(0, 0, 0, 0.62)",
    shadow: value.shadow ?? "#000000",
  });
}

function statusSet(
  draft: string,
  ready: string,
  scheduled: string,
  publishing: string,
  published: string,
  failed: string,
): NativeColorRoles["status"] {
  return { draft, ready, scheduled, publishing, published, failed };
}

function manifest(
  familyId: BuiltinThemeId,
  displayName: string,
  scheme: NativeThemeScheme,
  colors: Palette,
  focalColor = colors.primary,
): NativeThemeManifest {
  const personality = BUILTIN_PERSONALITIES[familyId];
  const depthColor = scheme === "dark" ? "#0A0B09" : withAlpha(colors.onSurface, 0.72);
  const focalContent =
    scheme === "dark" && focalColor === colors.primary ? colors.onPrimary : "#FFFFFF";
  const focal = actionStyle({
    container: focalColor,
    content: focalContent,
    pressedContainer: focalColor,
    depthColor,
    border: focalColor,
    ...personality.actions.focal,
  });
  return deepFreeze({
    id: `${familyId}-${scheme}`,
    familyId,
    displayName,
    scheme,
    colors,
    actions: {
      focal,
      primary: actionStyle({
        container: colors.primary,
        content: colors.onPrimary,
        pressedContainer: colors.primary,
        border: colors.primary,
        depthColor,
        ...personality.actions.primary,
      }),
      ordinary: actionStyle({
        container: colors.primaryContainer,
        content: colors.onPrimaryContainer,
        pressedContainer: colors.secondaryContainer,
        border: colors.outline,
        depthColor,
        ...personality.actions.ordinary,
      }),
      quiet: actionStyle({
        container: "transparent",
        content: colors.primary,
        pressedContainer: colors.primaryContainer,
        pressedContent: colors.onPrimaryContainer,
      }),
      destructive: actionStyle({
        container: "transparent",
        content: colors.error,
        pressedContainer: colors.errorContainer,
      }),
      link: actionStyle({
        container: "transparent",
        content: colors.link,
        pressedContainer: colors.primaryContainer,
        underline: true,
      }),
    },
    editor: scheme === "dark" ? DARK_EDITOR_ROLES : LIGHT_EDITOR_ROLES,
    typography: personality.typography,
    shape: personality.shape,
    spacing: personality.spacing,
    motion: personality.motion,
    decoration: {
      celebration: [colors.primary, colors.link, colors.primaryContainer, colors.surface],
    },
    iconography: {
      packId: ICON_PACK_BY_FAMILY[familyId],
      roles: BUILTIN_ICON_ROLE_MAPS[ICON_PACK_BY_FAMILY[familyId]],
    },
  });
}

function actionStyle(
  values: Partial<NativeActionStyle> & Pick<NativeActionStyle, "container" | "content">,
): NativeActionStyle {
  return {
    border: values.border ?? "transparent",
    borderWidth: values.borderWidth ?? 0,
    container: values.container,
    content: values.content,
    depth: values.depth ?? 0,
    depthColor: values.depthColor ?? "transparent",
    disabledOpacity: values.disabledOpacity ?? 0.42,
    pressedContainer: values.pressedContainer ?? values.container,
    pressedContent: values.pressedContent ?? values.content,
    underline: values.underline ?? false,
  };
}

function family(
  id: BuiltinThemeId,
  displayName: string,
  manifests: Partial<Record<NativeThemeScheme, NativeThemeManifest>>,
): NativeThemeFamily {
  const supportedSchemes = (["light", "dark"] as const).filter(
    (scheme) => manifests[scheme] !== undefined,
  );
  return { id, displayName, builtinVersion: 1, supportedSchemes, manifests };
}

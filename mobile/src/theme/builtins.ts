import {
  ACTION_INTENTS,
  NATIVE_ICON_ROLES,
  NATIVE_THEME_CONTRACT_VERSION,
  PUBLICATION_STATUSES,
  type NativeActionStyle,
  type NativeColorRoles,
  type NativeIconPackId,
  type NativeIconRole,
  type NativeProtectedEditorRoles,
  type NativeResolvedThemeContract,
  type NativeTextRole,
  type NativeThemeFamily,
  type NativeThemeManifest,
  type NativeThemeScheme,
} from "./contract";
import { deepFreeze, withAlpha } from "./freeze";

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
type ThemeShape = "precise" | "soft" | "round" | "paper";

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

const LUCIDE_ICON_ROLES: Readonly<Record<NativeIconRole, string>> = {
  add: "plus",
  back: "arrow-left",
  close: "x",
  menu: "menu",
  more: "ellipsis",
  search: "search",
  settings: "settings",
  edit: "pencil",
  delete: "trash-2",
  check: "check",
  retry: "rotate-cw",
  calendar: "calendar-days",
  queue: "clock-3",
  drafts: "file-pen-line",
  workspace: "panels-top-left",
  link: "external-link",
  upload: "upload",
  download: "download",
  image: "image",
  video: "video",
  account: "circle-user-round",
  notification: "bell",
  warning: "triangle-alert",
  error: "circle-x",
  success: "circle-check",
  play: "play",
  pause: "pause",
  undo: "undo-2",
  redo: "redo-2",
};

const HEROICON_ROLES: Readonly<Record<NativeIconRole, string>> = {
  ...LUCIDE_ICON_ROLES,
  close: "x-mark",
  menu: "bars-3",
  more: "ellipsis-horizontal",
  search: "magnifying-glass",
  settings: "cog-6-tooth",
  edit: "pencil-square",
  delete: "trash",
  retry: "arrow-path",
  queue: "clock",
  drafts: "document-text",
  workspace: "squares-2x2",
  link: "arrow-top-right-on-square",
  upload: "arrow-up-tray",
  download: "arrow-down-tray",
  image: "photo",
  video: "video-camera",
  account: "user-circle",
  warning: "exclamation-triangle",
  error: "x-circle",
  success: "check-circle",
  undo: "arrow-uturn-left",
  redo: "arrow-uturn-right",
};

const ICON_ROLE_MAPS: Readonly<Record<NativeIconPackId, Readonly<Record<NativeIconRole, string>>>> =
  deepFreeze({
    lucide: LUCIDE_ICON_ROLES,
    "heroicons-outline": HEROICON_ROLES,
    "heroicons-solid": HEROICON_ROLES,
    phosphor: {
      ...LUCIDE_ICON_ROLES,
      close: "x",
      menu: "list",
      more: "dots-three",
      search: "magnifying-glass",
      settings: "gear",
      edit: "pencil-simple",
      delete: "trash",
      retry: "arrow-clockwise",
      calendar: "calendar-blank",
      queue: "clock",
      drafts: "note-pencil",
      workspace: "squares-four",
      link: "arrow-square-out",
      upload: "upload-simple",
      download: "download-simple",
      video: "video-camera",
      account: "user-circle",
      warning: "warning",
      error: "x-circle",
      success: "check-circle",
      undo: "arrow-u-up-left",
      redo: "arrow-u-up-right",
    },
    tabler: {
      ...LUCIDE_ICON_ROLES,
      close: "x",
      menu: "menu-2",
      more: "dots",
      settings: "settings",
      edit: "edit",
      delete: "trash",
      retry: "refresh",
      calendar: "calendar",
      queue: "clock",
      drafts: "file-pencil",
      workspace: "layout-dashboard",
      upload: "upload",
      download: "download",
      image: "photo",
      account: "user-circle",
      warning: "alert-triangle",
      error: "circle-x",
      success: "circle-check",
      play: "player-play",
      pause: "player-pause",
      undo: "arrow-back-up",
      redo: "arrow-forward-up",
    },
  });

const TYPE_ROLES = deepFreeze({
  displayLarge: textRole(57, 64, "400", -1.4),
  headlineLarge: textRole(32, 40, "600", -0.5),
  titleLarge: textRole(24, 30, "700", -0.35),
  titleMedium: textRole(18, 24, "600", -0.1),
  bodyLarge: textRole(16, 24, "400", 0.1),
  bodyMedium: textRole(14, 20, "400", 0.15),
  bodySmall: textRole(12, 16, "400", 0.2),
  labelLarge: textRole(16, 20, "600", 0.1),
  labelMedium: textRole(12, 16, "600", 0.25),
});

const SHAPES = deepFreeze({
  precise: { extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 24, full: 999 },
  soft: { extraSmall: 6, small: 10, medium: 14, large: 18, extraLarge: 26, full: 999 },
  round: { extraSmall: 8, small: 12, medium: 16, large: 22, extraLarge: 30, full: 999 },
  paper: { extraSmall: 3, small: 6, medium: 10, large: 14, extraLarge: 20, full: 999 },
} satisfies Record<ThemeShape, NativeThemeManifest["shape"]>);

const SPACING = deepFreeze({
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 24,
  doubleExtraLarge: 32,
});

const MOTION = deepFreeze({ quickMs: 120, standardMs: 220, emphasizedMs: 360 });

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
      light: manifest("workshop", "Workshop", "light", WORKSHOP_LIGHT, "soft"),
      dark: manifest("workshop", "Workshop", "dark", WORKSHOP_DARK, "soft"),
    }),
    studio: family("studio", "Studio", {
      light: manifest("studio", "Studio", "light", STUDIO_LIGHT, "round"),
    }),
    notebook: family("notebook", "Notebook", {
      light: manifest("notebook", "Notebook", "light", NOTEBOOK_LIGHT, "paper", "#945F00"),
    }),
    playroom: family("playroom", "Playroom", {
      light: manifest("playroom", "Playroom", "light", PLAYROOM_LIGHT, "round"),
    }),
    "cloud-garden": family("cloud-garden", "Cloud Garden", {
      light: manifest(
        "cloud-garden",
        "Cloud Garden",
        "light",
        CLOUD_GARDEN_LIGHT,
        "soft",
        "#173D32",
      ),
    }),
    "study-hall": family("study-hall", "Study Hall", {
      light: manifest("study-hall", "Study Hall", "light", STUDY_HALL_LIGHT, "soft"),
    }),
    corkboard: family("corkboard", "Corkboard", {
      light: manifest("corkboard", "Corkboard", "light", CORKBOARD_LIGHT, "paper"),
    }),
    midnight: family("midnight", "Midnight", {
      dark: manifest("midnight", "Midnight", "dark", MIDNIGHT_DARK, "precise"),
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
  organizationId,
  workspaceId,
}: {
  familyId: BuiltinThemeId;
  identity: string;
  organizationId: string;
  workspaceId: string;
}): NativeResolvedThemeContract {
  const family = BUILTIN_THEME_FAMILIES[familyId];
  return deepFreeze({
    contractVersion: NATIVE_THEME_CONTRACT_VERSION,
    identity,
    organizationId,
    workspaceId,
    themeId: family.id,
    displayName: family.displayName,
    revision: `builtin-${family.builtinVersion}`,
    supportedSchemes: family.supportedSchemes,
    manifests: family.manifests,
  });
}

export function validateNativeThemeManifest(
  value: NativeThemeManifest | null | undefined,
): value is NativeThemeManifest {
  if (!value || !isText(value.id) || !isText(value.familyId) || !isText(value.displayName)) {
    return false;
  }
  if (value.scheme !== "light" && value.scheme !== "dark") return false;

  const colors = value.colors;
  const colorKeys = [
    "background",
    "surface",
    "surfaceContainer",
    "surfaceContainerHigh",
    "onSurface",
    "onSurfaceVariant",
    "outline",
    "outlineVariant",
    "primary",
    "onPrimary",
    "primaryContainer",
    "onPrimaryContainer",
    "secondaryContainer",
    "onSecondaryContainer",
    "error",
    "onError",
    "errorContainer",
    "onErrorContainer",
    "success",
    "onSuccess",
    "warning",
    "onWarning",
    "link",
    "focus",
    "scrim",
    "shadow",
  ] as const;
  if (!colors || colorKeys.some((key) => !isText(colors[key]))) return false;
  if (PUBLICATION_STATUSES.some((status) => !isText(colors.status?.[status]))) return false;

  if (
    ACTION_INTENTS.some((intent) => {
      const action = value.actions?.[intent];
      return (
        !action ||
        !isText(action.container) ||
        !isText(action.content) ||
        !isText(action.border) ||
        !isText(action.pressedContainer) ||
        !isText(action.depthColor) ||
        !isNumber(action.borderWidth) ||
        !isNumber(action.depth) ||
        !isNumber(action.disabledOpacity) ||
        typeof action.underline !== "boolean"
      );
    })
  ) {
    return false;
  }

  const editorKeys = [
    "canvas",
    "canvasGrid",
    "canvasSelection",
    "canvasSelectionText",
    "transparencyLight",
    "transparencyDark",
    "timeline",
    "timelineTrack",
    "timelinePlayhead",
    "waveform",
    "handle",
    "safeArea",
    "mediaScrim",
  ] as const;
  if (editorKeys.some((key) => !isText(value.editor?.[key]))) return false;

  const typeKeys = [
    "displayLarge",
    "headlineLarge",
    "titleLarge",
    "titleMedium",
    "bodyLarge",
    "bodyMedium",
    "bodySmall",
    "labelLarge",
    "labelMedium",
  ] as const;
  if (
    typeKeys.some((key) => {
      const role = value.typography?.[key];
      return (
        !role ||
        !isNumber(role.fontSize) ||
        !isNumber(role.lineHeight) ||
        !isNumber(role.letterSpacing) ||
        !isText(role.fontWeight)
      );
    })
  ) {
    return false;
  }

  return (
    numericRoles(value.shape, ["extraSmall", "small", "medium", "large", "extraLarge", "full"]) &&
    numericRoles(value.spacing, [
      "extraSmall",
      "small",
      "medium",
      "large",
      "extraLarge",
      "doubleExtraLarge",
    ]) &&
    numericRoles(value.motion, ["quickMs", "standardMs", "emphasizedMs"]) &&
    Array.isArray(value.decoration?.celebration) &&
    value.decoration.celebration.length > 0 &&
    value.decoration.celebration.every(isText) &&
    ["lucide", "heroicons-outline", "heroicons-solid", "phosphor", "tabler"].includes(
      value.iconography?.packId,
    ) &&
    NATIVE_ICON_ROLES.every((role) => isText(value.iconography?.roles?.[role]))
  );
}

function textRole(
  fontSize: number,
  lineHeight: number,
  fontWeight: NativeTextRole["fontWeight"],
  letterSpacing: number,
): NativeTextRole {
  return { fontSize, fontWeight, letterSpacing, lineHeight };
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
  shape: ThemeShape,
  focalColor = colors.primary,
): NativeThemeManifest {
  const focalContent =
    scheme === "dark" && focalColor === colors.primary ? colors.onPrimary : "#FFFFFF";
  const focal = actionStyle({
    container: focalColor,
    content: focalContent,
    pressedContainer: focalColor,
    depthColor: scheme === "dark" ? "#0A0B09" : withAlpha(colors.onSurface, 0.72),
    border: focalColor,
    borderWidth: 1,
    depth: 2,
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
      }),
      ordinary: actionStyle({
        container: colors.primaryContainer,
        content: colors.onPrimaryContainer,
        pressedContainer: colors.secondaryContainer,
      }),
      quiet: actionStyle({
        container: "transparent",
        content: colors.primary,
        pressedContainer: colors.primaryContainer,
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
    typography: TYPE_ROLES,
    shape: SHAPES[shape],
    spacing: SPACING,
    motion: MOTION,
    decoration: {
      celebration: [colors.primary, colors.link, colors.primaryContainer, colors.surface],
    },
    iconography: {
      packId: ICON_PACK_BY_FAMILY[familyId],
      roles: ICON_ROLE_MAPS[ICON_PACK_BY_FAMILY[familyId]],
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

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numericRoles(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const roles = value as Record<string, unknown>;
  return keys.every((key) => isNumber(roles[key]));
}

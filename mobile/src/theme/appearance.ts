import type { NativeThemeScheme, NativeThemeSnapshot } from "./contract";
import type { NativeThemeChoice } from "./settings-context";

export function themeAvailabilityMessage(
  source: NativeThemeSnapshot["source"],
  effectiveScheme: NativeThemeScheme,
): string {
  if (source.kind === "contract") {
    return source.resolutionSource === "fallback"
      ? "Workshop replaced a workspace theme that could not be applied safely."
      : "Applied to this workspace.";
  }
  if (source.reason === "contract-unavailable") {
    return "Workshop is shown until this workspace theme is ready.";
  }
  if (source.reason === "resources-unavailable") {
    return "Workshop is shown while this theme finishes loading.";
  }
  if (source.reason === "unsupported-scheme") {
    return `This theme does not include ${effectiveScheme} mode, so Workshop is shown.`;
  }
  if (source.reason === "stale-contract") {
    return "Workshop is shown while this workspace theme changes.";
  }
  return "Workshop replaced a theme that could not be applied safely.";
}

export function themeChoiceDescription(
  choice: NativeThemeChoice,
  effectiveScheme: NativeThemeScheme,
): string {
  if (!choice.supportedSchemes.includes(effectiveScheme)) {
    return `Uses Workshop in ${effectiveScheme} mode.`;
  }
  return choice.description ?? "Ready for this workspace.";
}

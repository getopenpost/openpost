import { workshopTheme } from "./builtins/workshop.js";
import type { ThemeScheme } from "./contracts.js";
import { resolveLocalTheme } from "./resolve.js";

// Startup and runtime recovery need only Workshop, not the appearance catalog.
export function resolveWorkshopTheme(scheme: ThemeScheme) {
  return resolveLocalTheme(workshopTheme, scheme);
}

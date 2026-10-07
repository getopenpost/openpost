import type { ResolvedTheme, ThemeManifest, ThemeScheme } from "./contracts.js";

/** Resolve a bundled manifest without importing the whole appearance catalogue. */
export function resolveLocalTheme(theme: ThemeManifest, scheme: ThemeScheme): ResolvedTheme {
  const manifest = theme.schemes[scheme];
  if (!manifest) throw new Error(`Theme ${theme.id} does not support ${scheme}.`);
  return {
    id: theme.id,
    revision: theme.revision,
    name: theme.name,
    iconPack: theme.iconPack,
    source: "builtin",
    requestedScheme: scheme,
    scheme,
    manifest: structuredClone(manifest),
    fonts: [],
    assets: structuredClone(theme.assets),
  };
}

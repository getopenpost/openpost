import { resolve } from "node:path";

import {
  adaptResolvedThemeResponse,
  type ApiResolvedThemeResponse,
} from "../mobile/src/theme/api-adapter";
import type {
  NativeThemeFamily,
  NativeThemeManifest,
  NativeThemeScheme,
} from "../mobile/src/theme/contract";

interface CanonicalBuiltinTheme {
  schemaVersion: number;
  id: string;
  revision: string;
  name: string;
  iconPack: string;
  supportedSchemes: NativeThemeScheme[];
  schemes: Partial<Record<NativeThemeScheme, ApiResolvedThemeResponse["manifest"]>>;
  fonts: ApiResolvedThemeResponse["fonts"];
  assets: ApiResolvedThemeResponse["assets"];
}

const projectRoot = resolve(import.meta.dir, "..");
const sourcePath = resolve(projectRoot, "backend/internal/services/themes/builtins.v1.json");
const outputPath = resolve(projectRoot, "mobile/src/theme/builtins.generated.ts");
const canonical = (await Bun.file(sourcePath).json()) as CanonicalBuiltinTheme[];

const families: Record<string, NativeThemeFamily> = {};
for (const family of canonical) {
  if (family.schemaVersion !== 1 || !/^builtin-v[1-9][0-9]*$/.test(family.revision)) {
    throw new Error(`Unsupported canonical built-in ${family.id}@${family.revision}`);
  }
  const manifests: Partial<Record<NativeThemeScheme, NativeThemeManifest>> = {};
  for (const scheme of family.supportedSchemes) {
    const manifest = family.schemes[scheme];
    if (!manifest) throw new Error(`${family.id} declares a missing ${scheme} scheme`);
    const response: ApiResolvedThemeResponse = {
      id: family.id,
      revision: family.revision,
      name: family.name,
      iconPack: family.iconPack,
      source: "builtin",
      requestedScheme: scheme,
      scheme,
      manifest,
      fonts: family.fonts,
      assets: family.assets,
    };
    const adapted = adaptResolvedThemeResponse({
      cacheIdentity: `${family.id}:${family.revision}:${scheme}`,
      response,
      workspaceId: "builtin-template",
    });
    if (!adapted.ok) throw new Error(`Cannot adapt canonical ${family.id} ${scheme} for native`);
    manifests[scheme] = adapted.contract.manifests[scheme];
  }
  families[family.id] = {
    id: family.id,
    displayName: family.name,
    revision: family.revision,
    supportedSchemes: family.supportedSchemes,
    manifests,
  };
}

const unformatted = `// Generated from backend/internal/services/themes/builtins.v1.json. Do not edit by hand.\nimport type { NativeThemeFamily } from "./contract";\n\nexport const GENERATED_BUILTIN_THEME_IDS = ${JSON.stringify(
  canonical.map((family) => family.id),
)} as const;\n\nexport const GENERATED_BUILTIN_THEME_FAMILIES = ${JSON.stringify(
  families,
  null,
  2,
)} as const satisfies Readonly<Record<string, NativeThemeFamily>>;\n`;
const formatter = Bun.spawn(["bunx", "oxfmt", `--stdin-filepath=${outputPath}`], {
  cwd: projectRoot,
  stdin: new Blob([unformatted]),
  stdout: "pipe",
  stderr: "inherit",
});
const generated = await new Response(formatter.stdout).text();
if ((await formatter.exited) !== 0) throw new Error("Could not format native built-in themes");

if (process.argv.includes("--check")) {
  const current = await Bun.file(outputPath).text();
  if (current !== generated) {
    console.error("Native built-in themes are stale. Run `bun run generate:themes` from mobile.");
    process.exit(1);
  }
} else {
  await Bun.write(outputPath, generated);
}

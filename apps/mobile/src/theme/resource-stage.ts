import type {
  NativeResolvedThemeContract,
  NativeStagedThemeResources,
  NativeThemeAssetResource,
  NativeThemeFontResource,
} from "./contract";
import { deepFreeze } from "./freeze";

export type NativeThemeResourceDownloadRequest =
  | Readonly<{
      kind: "font";
      id: string;
      sourceUrl: string;
      format: NativeThemeFontResource["nativeDerivative"]["format"];
      expectedIdentity: string;
    }>
  | Readonly<{
      kind: "asset";
      id: string;
      sourceUrl: string;
      mimeType: NativeThemeAssetResource["mimeType"];
      slot: NativeThemeAssetResource["slot"];
    }>;

export interface NativeThemeDownloadedResource {
  readonly uri: string;
  /** SHA-256 of the downloaded bytes. Required for native font derivatives. */
  readonly identity?: string;
}

export interface NativeThemeFontLoad {
  readonly id: string;
  readonly family: string;
  readonly uri: string;
  readonly format: NativeThemeFontResource["nativeDerivative"]["format"];
}

export interface NativeThemeResourceStageAdapter {
  download(request: NativeThemeResourceDownloadRequest): Promise<NativeThemeDownloadedResource>;
  loadFonts(fonts: readonly NativeThemeFontLoad[]): Promise<void>;
}

/**
 * Downloads and decodes every resource before exposing any part of a theme.
 * The caller supplies authenticated storage I/O and owns the generation check.
 */
export async function stageNativeThemeResources({
  adapter,
  contract,
  isCurrent = () => true,
}: {
  adapter: NativeThemeResourceStageAdapter;
  contract: NativeResolvedThemeContract;
  isCurrent?: () => boolean;
}): Promise<NativeStagedThemeResources | null> {
  const { assets, fonts } = contract.resources;
  if (assets.length === 0 && fonts.length === 0) return null;
  if (!isCurrent()) return null;

  const [downloadedFonts, downloadedAssets] = await Promise.all([
    Promise.all(
      fonts.map(async (font) => {
        const downloaded = await adapter.download({
          kind: "font",
          id: font.id,
          sourceUrl: font.nativeDerivative.sourceUrl,
          format: font.nativeDerivative.format,
          expectedIdentity: font.nativeDerivative.identity,
        });
        requireFileURI(downloaded.uri, font.id);
        if (downloaded.identity?.toLowerCase() !== font.nativeDerivative.identity.toLowerCase()) {
          throw new Error(`${font.id} did not match its native derivative identity`);
        }
        return {
          id: font.id,
          family: font.family,
          uri: downloaded.uri,
          format: font.nativeDerivative.format,
          derivativeIdentity: font.nativeDerivative.identity.toLowerCase(),
        } as const;
      }),
    ),
    Promise.all(
      assets.map(async (asset) => {
        const downloaded = await adapter.download({
          kind: "asset",
          id: asset.id,
          sourceUrl: asset.sourceUrl,
          mimeType: asset.mimeType,
          slot: asset.slot,
        });
        requireFileURI(downloaded.uri, asset.id);
        return { id: asset.id, uri: downloaded.uri } as const;
      }),
    ),
  ]);

  if (!isCurrent()) return null;
  await adapter.loadFonts(
    downloadedFonts.map(({ family, format, id, uri }) => ({ family, format, id, uri })),
  );
  if (!isCurrent()) return null;

  return deepFreeze({
    contractIdentity: contract.identity,
    resourceIdentity: contract.resources.identity,
    workspaceId: contract.workspaceId,
    fonts: Object.fromEntries(
      downloadedFonts.map(({ derivativeIdentity, family, format, id, uri }) => [
        id,
        { derivativeIdentity, family, format, uri },
      ]),
    ),
    assets: Object.fromEntries(downloadedAssets.map(({ id, uri }) => [id, uri])),
  });
}

function requireFileURI(uri: string, resourceId: string): void {
  if (!uri.startsWith("file://")) {
    throw new Error(`${resourceId} was not staged as a local file`);
  }
}

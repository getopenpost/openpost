import { loadEditorFontAsset } from '$lib/editor-fonts';
import type { MediaMetadata } from '../media/types';
import { resolveMediaBlob } from '../media/resolve-media-blob';
import type { Project, ProjectFontAsset, TimelineItem } from '../project/types';

export interface ProjectFontLoadRuntime {
	resolve: (media: MediaMetadata) => Promise<Blob>;
	load: (asset: ProjectFontAsset & { blob: Blob }) => Promise<void>;
}

const defaultFontLoadRuntime: ProjectFontLoadRuntime = {
	resolve: resolveMediaBlob,
	load: (asset) => loadEditorFontAsset({ ...asset, assetID: asset.id })
};

function itemFontAssets(item: TimelineItem): ProjectFontAsset[] {
	const assets: ProjectFontAsset[] = [];
	if (item.fontAssetId && item.fontFamily) {
		assets.push({
			id: item.fontAssetId,
			family: item.fontFamily,
			weight: item.fontWeight ?? 400,
			style: item.fontStyle ?? 'normal'
		});
	}
	for (const span of item.textSpans ?? []) {
		if (!span.fontAssetId) continue;
		assets.push({
			id: span.fontAssetId,
			family: span.fontFamily ?? item.fontFamily ?? 'Inter',
			weight: span.fontWeight ?? item.fontWeight ?? 400,
			style: span.fontStyle ?? item.fontStyle ?? 'normal'
		});
	}
	return assets;
}

export function projectFontAssets(
	project: Pick<Project, 'fontAssets' | 'timeline'>
): ProjectFontAsset[] {
	const unique = new Map<string, ProjectFontAsset>();
	if (project.timeline) {
		const items = [
			...project.timeline.items,
			...(project.timeline.compositions ?? []).flatMap((composition) => composition.items)
		];
		for (const asset of items.flatMap(itemFontAssets)) unique.set(asset.id, asset);
	}
	for (const asset of project.fontAssets ?? []) unique.set(asset.id, asset);
	return [...unique.values()];
}

export async function loadProjectFontAsset(
	asset: ProjectFontAsset,
	media: MediaMetadata,
	runtime: ProjectFontLoadRuntime = defaultFontLoadRuntime
): Promise<void> {
	await runtime.load({ ...asset, blob: await runtime.resolve(media) });
}

export async function loadProjectFontAssets(
	project: Pick<Project, 'fontAssets' | 'timeline'>,
	media: readonly MediaMetadata[],
	runtime: ProjectFontLoadRuntime = defaultFontLoadRuntime
): Promise<string[]> {
	const mediaById = new Map(media.map((entry) => [entry.id, entry]));
	const failed: string[] = [];
	for (const asset of projectFontAssets(project)) {
		const source = mediaById.get(asset.id);
		if (!source) {
			failed.push(asset.id);
			continue;
		}
		try {
			await loadProjectFontAsset(asset, source, runtime);
		} catch {
			failed.push(asset.id);
		}
	}
	return [...new Set(failed)];
}

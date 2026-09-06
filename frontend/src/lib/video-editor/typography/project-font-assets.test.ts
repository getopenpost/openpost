import { describe, expect, it, vi } from 'vitest';
import { createBlankProject } from '../project/defaults';
import type { MediaMetadata } from '../media/types';
import {
	loadProjectFontAsset,
	loadProjectFontAssets,
	projectFontAssets
} from './project-font-assets';

function fontMedia(id: string): MediaMetadata {
	return {
		id,
		storageType: 'workspace',
		fileName: `${id}.woff2`,
		fileSize: 4,
		mimeType: 'font/woff2',
		duration: 0,
		width: 0,
		height: 0,
		fps: 0,
		codec: 'font',
		bitrate: 0,
		tags: ['font']
	};
}

describe('project font assets', () => {
	it('collects item and span fonts from root and nested sequences', () => {
		const project = createBlankProject();
		project.timeline!.items = [
			{
				id: 'title',
				trackId: 'track',
				from: 0,
				durationInFrames: 30,
				label: 'Title',
				type: 'text',
				fontFamily: 'Launch Sans',
				fontAssetId: 'font-title',
				textSpans: [{ text: 'A', fontFamily: 'Launch Serif', fontAssetId: 'font-span' }]
			}
		];
		project.timeline!.compositions = [
			{
				id: 'nested',
				name: 'Nested',
				tracks: [],
				items: [
					{
						id: 'caption',
						trackId: 'nested-track',
						from: 0,
						durationInFrames: 30,
						label: 'Caption',
						type: 'subtitle',
						fontFamily: 'Launch Sans',
						fontAssetId: 'font-title'
					}
				]
			}
		];

		expect(projectFontAssets(project).map((asset) => asset.id)).toEqual([
			'font-title',
			'font-span'
		]);
	});

	it('loads project-owned font bytes and reports missing assets', async () => {
		const project = createBlankProject();
		project.timeline!.items = [
			{
				id: 'title',
				trackId: 'track',
				from: 0,
				durationInFrames: 30,
				label: 'Title',
				type: 'text',
				fontFamily: 'Launch Sans',
				fontAssetId: 'font-title',
				textSpans: [{ text: 'B', fontAssetId: 'font-missing' }]
			}
		];
		const load = vi.fn(async () => undefined);
		const missing = await loadProjectFontAssets(project, [fontMedia('font-title')], {
			resolve: async () => new Blob(['font']),
			load
		});

		expect(load).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'font-title', family: 'Launch Sans' })
		);
		expect(missing).toEqual(['font-missing']);
	});

	it('restores the immutable font file descriptor after authored styling changes', async () => {
		const project = createBlankProject();
		project.fontAssets = [
			{
				id: 'font-title',
				sourceAssetId: 'brand-font',
				family: 'Launch Sans',
				weight: 400,
				style: 'normal'
			}
		];
		project.timeline!.items = [
			{
				id: 'title',
				trackId: 'track',
				from: 0,
				durationInFrames: 30,
				label: 'Title',
				type: 'text',
				fontFamily: 'Launch Sans',
				fontAssetId: 'font-title',
				fontWeight: 700
			}
		];
		const load = vi.fn(async () => undefined);

		await loadProjectFontAssets(project, [fontMedia('font-title')], {
			resolve: async () => new Blob(['font']),
			load
		});

		expect(load).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'font-title',
				family: 'Launch Sans',
				weight: 400,
				style: 'normal'
			})
		);
	});

	it('retries an existing project font after a transient load failure', async () => {
		const asset = {
			id: 'font-title',
			family: 'Launch Sans',
			weight: 400,
			style: 'normal' as const
		};
		const load = vi
			.fn<(input: typeof asset & { blob: Blob }) => Promise<void>>()
			.mockRejectedValueOnce(new Error('Font decoder unavailable'))
			.mockResolvedValueOnce(undefined);
		const runtime = { resolve: async () => new Blob(['font']), load };

		await expect(loadProjectFontAsset(asset, fontMedia(asset.id), runtime)).rejects.toThrow(
			'Font decoder unavailable'
		);
		await expect(
			loadProjectFontAsset(asset, fontMedia(asset.id), runtime)
		).resolves.toBeUndefined();
		expect(load).toHaveBeenCalledTimes(2);
	});
});

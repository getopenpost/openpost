import { describe, expect, it } from 'vitest';
import type { ImageEditorDesignSummary } from '$lib/image-editor/types';
import type { CloudVideoProjectSummary } from '$lib/video-editor/api';
import {
	EditorCatalogCache,
	EditorCatalogRequestGate,
	editorCatalogKey,
	emptyEditorCatalog,
	mergeEditorCatalogItems
} from './editor-catalog';

function design(id: string): ImageEditorDesignSummary {
	return {
		id,
		title: id,
		preset_key: 'square',
		width_px: 1080,
		height_px: 1080,
		page_count: 1,
		revision: 1,
		cover_preview_media_id: '',
		is_favorite: false,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z'
	};
}

function video(id: string): CloudVideoProjectSummary {
	return {
		id,
		title: id,
		revision: 1,
		duration_ms: 1_000,
		source_count: 1,
		cover_preview_media_id: '',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z'
	};
}

describe('editor catalog state', () => {
	it('keys cached results by workspace and normalized server search', () => {
		expect(editorCatalogKey('workspace-a', ' Launch ')).toBe(
			editorCatalogKey('workspace-a', 'launch')
		);
		expect(editorCatalogKey('workspace-a', 'launch')).not.toBe(
			editorCatalogKey('workspace-b', 'launch')
		);
	});

	it('merges enough pages to expose catalogs beyond both former caps', () => {
		let designs: ImageEditorDesignSummary[] = [];
		for (let offset = 0; offset < 125; offset += 50) {
			designs = mergeEditorCatalogItems(
				designs,
				Array.from({ length: Math.min(50, 125 - offset) }, (_, index) =>
					design(`design-${offset + index}`)
				)
			);
		}
		let videos: CloudVideoProjectSummary[] = [];
		for (let offset = 0; offset < 75; offset += 50) {
			videos = mergeEditorCatalogItems(
				videos,
				Array.from({ length: Math.min(50, 75 - offset) }, (_, index) =>
					video(`video-${offset + index}`)
				)
			);
		}
		expect(designs).toHaveLength(125);
		expect(videos).toHaveLength(75);
	});

	it('aborts and rejects a slow request after its workspace is superseded', async () => {
		const gate = new EditorCatalogRequestGate();
		const stale = gate.begin(editorCatalogKey('workspace-a', ''));
		let releaseStale: (value: string) => void = () => undefined;
		const slowResponse = new Promise<string>((resolve) => {
			releaseStale = resolve;
		});
		const staleCommit = slowResponse.then((value) =>
			gate.accepts(stale, editorCatalogKey('workspace-b', '')) ? value : undefined
		);
		const current = gate.begin(editorCatalogKey('workspace-b', ''));

		expect(stale.signal.aborted).toBe(true);
		expect(gate.accepts(stale, current.key)).toBe(false);
		expect(gate.accepts(current, current.key)).toBe(true);
		releaseStale('stale workspace data');
		await expect(staleCommit).resolves.toBeUndefined();
	});

	it('rolls an optimistic deletion back only into the originating workspace caches', () => {
		const cache = new EditorCatalogCache();
		const workspaceA = {
			...emptyEditorCatalog('workspace-a', ''),
			videoProjects: [video('shared-id'), video('a-only')],
			videoTotal: 2,
			videoOffset: 2
		};
		const workspaceASearch = {
			...emptyEditorCatalog('workspace-a', 'shared'),
			videoProjects: [video('shared-id')],
			videoTotal: 1,
			videoOffset: 1
		};
		const workspaceB = {
			...emptyEditorCatalog('workspace-b', ''),
			videoProjects: [video('shared-id')],
			videoTotal: 1,
			videoOffset: 1
		};
		cache.write(workspaceA);
		cache.write(workspaceASearch);
		cache.write(workspaceB);

		const rollback = cache.remove('workspace-a', 'video', 'shared-id');
		expect(cache.read('workspace-a', '')?.videoProjects.map((item) => item.id)).toEqual(['a-only']);
		expect(cache.read('workspace-a', 'shared')?.videoProjects).toEqual([]);
		expect(cache.read('workspace-b', '')?.videoProjects.map((item) => item.id)).toEqual([
			'shared-id'
		]);

		cache.restore(rollback);
		expect(cache.read('workspace-a', '')?.videoProjects.map((item) => item.id)).toEqual([
			'shared-id',
			'a-only'
		]);
		expect(cache.read('workspace-a', 'shared')?.videoProjects.map((item) => item.id)).toEqual([
			'shared-id'
		]);

		cache.invalidateWorkspace('workspace-a');
		expect(cache.read('workspace-a', '')).toBeUndefined();
		expect(cache.read('workspace-a', 'shared')).toBeUndefined();
		expect(cache.read('workspace-b', '')?.videoProjects.map((item) => item.id)).toEqual([
			'shared-id'
		]);
	});
});

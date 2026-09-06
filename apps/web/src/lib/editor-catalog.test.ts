import { describe, expect, it } from 'vitest';
import type { ImageEditorDesignSummary } from '$lib/image-editor/types';
import {
	editorCatalogKey,
	mergeEditorCatalogItems,
	resolveEditorCatalogSurface
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

describe('editor catalog state', () => {
	it('keeps initial failures mutually exclusive with the empty catalog', () => {
		expect(
			resolveEditorCatalogSurface({
				loading: false,
				error: 'Workspace unavailable',
				designCount: 0
			})
		).toBe('error');
	});

	it('retains loaded catalog context when a refresh fails', () => {
		expect(
			resolveEditorCatalogSurface({
				loading: false,
				error: 'Refresh failed',
				designCount: 1
			})
		).toBe('content');
	});

	it('retains loaded catalog context while a retry is pending', () => {
		expect(
			resolveEditorCatalogSurface({
				loading: true,
				error: '',
				designCount: 1
			})
		).toBe('content');
	});

	it('keys cached results by workspace and normalized server search', () => {
		expect(editorCatalogKey('workspace-a', ' Launch ')).toBe(
			editorCatalogKey('workspace-a', 'launch')
		);
		expect(editorCatalogKey('workspace-a', 'launch')).not.toBe(
			editorCatalogKey('workspace-b', 'launch')
		);
	});

	it('merges enough pages to expose catalogs beyond former caps', () => {
		let designs: ImageEditorDesignSummary[] = [];
		for (let offset = 0; offset < 125; offset += 50) {
			designs = mergeEditorCatalogItems(
				designs,
				Array.from({ length: Math.min(50, 125 - offset) }, (_, index) =>
					design(`design-${offset + index}`)
				)
			);
		}
		expect(designs).toHaveLength(125);
	});
});

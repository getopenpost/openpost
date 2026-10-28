import { describe, expect, it } from 'vitest';
import {
	canDeleteMedia,
	normalizeMediaItem,
	type MediaItem,
	type MediaListResponseItem
} from './media-presentation';

const listItem: MediaListResponseItem = {
	id: 'media-1',
	workspace_id: 'workspace-1',
	url: 'https://cdn.example/media-1',
	thumbnail_url: 'https://cdn.example/media-1-thumb',
	original_filename: 'photo.png',
	mime_type: 'image/png',
	size: 2048,
	width: 640,
	height: 480,
	alt_text: 'A photo',
	is_favorite: false,
	created_at: '2026-01-01T00:00:00.000Z',
	source: 'upload',
	asset_kind: 'library',
	tags: ['tag-1'],
	usage_count: 2,
	can_delete: true,
	processing_status: 'ready',
	processing_progress: 100,
	analysis_status: 'ready',
	duration_ms: 0,
	frame_rate: 0,
	audio_channels: 0,
	bit_rate: 0,
	color_space: undefined,
	rotation: 0,
	retention_class: 'library',
	public_url_status: 0
};

const item: MediaItem = normalizeMediaItem(listItem);

describe('media deletion', () => {
	it('gates deletion on flags and usage', () => {
		expect(canDeleteMedia(item)).toBe(true);
		// An explicit backend false wins over an empty usage count.
		expect(canDeleteMedia({ ...item, can_delete: false, usage_count: 0 })).toBe(false);
		expect(canDeleteMedia({ ...item, can_delete: false, usage_count: 2 })).toBe(false);
	});
});

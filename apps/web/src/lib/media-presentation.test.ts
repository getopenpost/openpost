import { describe, expect, it } from 'vitest';
import {
	canDeleteMedia,
	errorMessage,
	formatSize,
	formatVideoDuration,
	isAudio,
	isImage,
	isVideo,
	mediaSourceLabel,
	mediaUsageKindLabel,
	normalizeMediaItem,
	normalizeMediaUsage,
	usageSummaryLabel,
	type MediaItem,
	type MediaListResponseItem,
	type MediaUsageResponseItem
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

describe('normalize', () => {
	it('defaults missing tags and usage fields', () => {
		expect(normalizeMediaItem({ ...listItem, tags: null })).toEqual({ ...item, tags: [] });
		const usage: MediaUsageResponseItem = { kind: 'publication', id: 'p', label: 'Post' };
		expect(normalizeMediaUsage(usage)).toEqual({
			kind: 'publication',
			id: 'p',
			label: 'Post',
			content: '',
			status: '',
			scheduled_at: ''
		});
	});

	it('falls back to the cause message', () => {
		expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom');
		expect(errorMessage('nope', 'fallback')).toBe('fallback');
	});
});

describe('formatting', () => {
	it('formats sizes and durations', () => {
		expect(formatSize(512)).toBe('512 B');
		expect(formatSize(2048)).toBe('2.0 KB');
		expect(formatVideoDuration(90000)).toBe('1:30');
		expect(formatVideoDuration(3723000)).toBe('1:02:03');
		expect(formatVideoDuration(-1)).toBe('—');
	});

	it('classifies mime types', () => {
		expect(isImage('image/png')).toBe(true);
		expect(isVideo('video/mp4')).toBe(true);
		expect(isAudio('audio/mpeg')).toBe(true);
		expect(isImage('video/mp4')).toBe(false);
	});

	it('labels sources, kinds and counts', () => {
		expect(mediaSourceLabel('camera')).toContain('Camera');
		expect(mediaSourceLabel('unknown-source')).toContain('pload');
		expect(mediaUsageKindLabel('publication')).toContain('ost');
		expect(mediaUsageKindLabel('custom_kind')).toBe('custom kind');
		expect(usageSummaryLabel(1)).toContain('1');
		expect(usageSummaryLabel(3)).toContain('3');
	});

	it('gates deletion on flags and usage', () => {
		expect(canDeleteMedia(item)).toBe(true);
		// An explicit backend false wins over an empty usage count.
		expect(canDeleteMedia({ ...item, can_delete: false, usage_count: 0 })).toBe(false);
		expect(canDeleteMedia({ ...item, can_delete: false, usage_count: 2 })).toBe(false);
	});
});

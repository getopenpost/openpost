import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { assessExportPreflight, type ExportPreflightSettings } from './export-preflight';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const video: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 30,
	durationInFrames: 300,
	label: 'Interview',
	type: 'video',
	mediaId: 'media-video'
};

const baseSettings: ExportPreflightSettings = {
	format: 'mp4',
	codec: 'avc',
	quality: 'standard',
	width: 1920,
	height: 1080,
	subtitleMode: 'burn'
};

describe('assessExportPreflight', () => {
	it('reports a ready worker render with exact range and size estimates', () => {
		const result = assessExportPreflight({
			settings: baseSettings,
			fps: 30,
			items: [video],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { 'media-video': 'ready' }
		});

		expect(result.canExport).toBe(true);
		expect(result.predictedRenderPath).toBe('worker');
		expect(result.range).toEqual({ startFrame: 0, endFrame: 330, frameCount: 330 });
		expect(result.estimatedDurationSeconds).toBe(11);
		expect(result.estimatedFileSizeBytes).toBeGreaterThan(11_000_000);
		expect(result.checks.map((check) => check.id)).toEqual([
			'export-range-ready',
			'media-ready',
			'video-codec-supported',
			'worker-render'
		]);
	});

	it('recognizes an untouched keyframe-aligned source without requiring an encoder', () => {
		const untouched = { ...video, from: 0, transform: { width: 1920, height: 1080 } };
		const result = assessExportPreflight({
			settings: { ...baseSettings, format: 'mp4', subtitleMode: 'none' },
			fps: 30,
			items: [untouched],
			tracks: [videoTrack],
			codecSupported: false,
			mediaStatuses: { 'media-video': 'ready' },
			media: [
				{
					id: 'media-video',
					storageType: 'workspace',
					fileName: 'video.mp4',
					fileSize: 1_000_000,
					mimeType: 'video/mp4',
					duration: 10,
					width: 1920,
					height: 1080,
					fps: 30,
					codec: 'avc',
					bitrate: 4_000_000,
					keyframeTimestamps: [0, 2, 4, 6, 8],
					tags: ['video']
				}
			]
		});

		expect(result.canExport).toBe(true);
		expect(result.pending).toBe(false);
		expect(result.predictedRenderPath).toBe('smart-copy');
		expect(result.checks).toContainEqual({ id: 'smart-copy', severity: 'info' });
		expect(result.checks.some((check) => check.id === 'video-codec-unavailable')).toBe(false);
	});

	it('blocks invalid ranges, missing media, and unavailable codecs together', () => {
		const result = assessExportPreflight({
			settings: { ...baseSettings, range: { startFrame: 120, endFrame: 120 } },
			fps: 30,
			items: [video],
			tracks: [videoTrack],
			codecSupported: false,
			mediaStatuses: { 'media-video': 'failed' }
		});

		expect(result.canExport).toBe(false);
		expect(result.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'empty-range', severity: 'error' }),
				expect.objectContaining({ id: 'missing-media', severity: 'error', count: 1 }),
				expect.objectContaining({ id: 'video-codec-unavailable', severity: 'error' })
			])
		);
	});

	it('requires audible content for audio export and explains subtitle fallback', () => {
		const audioOnly = assessExportPreflight({
			settings: { ...baseSettings, format: 'wav', codec: undefined, subtitleMode: 'none' },
			fps: 30,
			items: [{ ...video, type: 'image', mediaId: 'image' }],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { image: 'ready' }
		});
		expect(audioOnly.canExport).toBe(false);
		expect(audioOnly.checks).toContainEqual(
			expect.objectContaining({ id: 'no-audible-content', severity: 'error' })
		);

		const fallback = assessExportPreflight({
			settings: { ...baseSettings, subtitleMode: 'embedded' },
			fps: 30,
			items: [video],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { 'media-video': 'ready' }
		});
		expect(fallback.canExport).toBe(true);
		expect(fallback.checks).toContainEqual(
			expect.objectContaining({ id: 'subtitle-burn-fallback', severity: 'warning' })
		);
	});

	it('warns for long renders and blocks files that exceed the in-memory output limit', () => {
		const result = assessExportPreflight({
			settings: { ...baseSettings, quality: 'high' },
			fps: 30,
			items: [{ ...video, from: 0, durationInFrames: 30 * 60 * 60 }],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { 'media-video': 'ready' },
			streamingAvailable: false
		});

		expect(result.canExport).toBe(false);
		expect(result.estimatedFileSizeBytes).toBeGreaterThan(2 * 1024 ** 3);
		expect(result.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'long-render', severity: 'warning' }),
				expect.objectContaining({ id: 'output-too-large', severity: 'error' })
			])
		);
	});

	it('allows large outputs when workspace streaming is available', () => {
		const result = assessExportPreflight({
			settings: { ...baseSettings, quality: 'high' },
			fps: 30,
			items: [{ ...video, from: 0, durationInFrames: 30 * 60 * 60 }],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { 'media-video': 'ready' },
			streamingAvailable: true
		});

		expect(result.canExport).toBe(true);
		expect(result.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'streaming-active', severity: 'info' })
			])
		);
		expect(result.checks.some((check) => check.id === 'output-too-large')).toBe(false);
	});

	it('keeps small outputs on the in-memory path without requiring streaming', () => {
		const result = assessExportPreflight({
			settings: baseSettings,
			fps: 30,
			items: [video],
			tracks: [videoTrack],
			codecSupported: true,
			mediaStatuses: { 'media-video': 'ready' },
			streamingAvailable: true
		});

		expect(result.canExport).toBe(true);
		expect(result.checks.some((check) => check.id === 'streaming-active')).toBe(false);
		expect(result.checks.some((check) => check.id === 'output-too-large')).toBe(false);
	});
});

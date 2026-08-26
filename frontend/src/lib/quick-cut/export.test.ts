import { describe, expect, it } from 'vitest';
import { preflightExport } from './export';
import { createSegment } from './model';
import type { QuickCutSource } from './types';

function makeSource(id: string, overrides: Partial<QuickCutSource> = {}): QuickCutSource {
	return {
		id,
		name: `${id}.mp4`,
		size: 10_000_000,
		mimeType: 'video/mp4',
		duration: 10,
		width: 1280,
		height: 720,
		videoCodec: 'avc',
		audioCodec: 'aac',
		sampleRate: 48000,
		channels: 2,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [0, 2, 4, 6, 8],
		...overrides
	};
}

describe('quick-cut preflight', () => {
	it('reports stream copy when starts are on keyframes', async () => {
		const src = makeSource('s1');
		const segs = [createSegment(0, 2, { sourceId: 's1' }), createSegment(4, 6, { sourceId: 's1' })];
		const pre = await preflightExport([src], segs, 'nearestKeyframe', false);
		expect(pre.eligible).toBe(true);
		expect(pre.perSegment.every((p) => !p.requiresTranscode)).toBe(true);
	});

	it('requires transcode for exact cut off keyframe per segment', async () => {
		const src = makeSource('s1');
		const segs = [
			createSegment(0.5, 2, { sourceId: 's1' }),
			createSegment(4, 6, { sourceId: 's1' })
		];
		const pre = await preflightExport([src], segs, 'exact', false);
		expect(pre.perSegment[0]?.requiresTranscode).toBe(true);
		expect(pre.perSegment[1]?.requiresTranscode).toBe(false);
	});

	it('detects incompatible codecs for merge', async () => {
		const s1 = makeSource('s1', { videoCodec: 'avc' });
		const s2 = makeSource('s2', { videoCodec: 'hevc' });
		const segs = [createSegment(0, 2, { sourceId: 's1' }), createSegment(0, 2, { sourceId: 's2' })];
		const pre = await preflightExport([s1, s2], segs, 'nearestKeyframe', true);
		expect(pre.requiresTranscode).toBe(true);
	});

	it('detects different dimensions', async () => {
		const s1 = makeSource('s1', { width: 1280, height: 720 });
		const s2 = makeSource('s2', { width: 1920, height: 1080 });
		const segs = [createSegment(0, 2, { sourceId: 's1' }), createSegment(0, 2, { sourceId: 's2' })];
		const pre = await preflightExport([s1, s2], segs, 'nearestKeyframe', true);
		expect(pre.requiresTranscode).toBe(true);
	});

	it('re-encodes an exact audio cut but keeps nearest packet copy lossless', async () => {
		const source = makeSource('audio', {
			name: 'audio.webm',
			mimeType: 'audio/webm',
			videoCodec: null,
			width: null,
			height: null,
			fps: null,
			keyframeTimestamps: [],
			keyframeState: 'audio-only',
			audioCodec: 'opus'
		});
		const segments = [createSegment(0.125, 0.625, { sourceId: source.id })];
		const exact = await preflightExport([source], segments, 'exact', true);
		const nearest = await preflightExport([source], segments, 'nearestKeyframe', true);
		expect(exact.requiresTranscode).toBe(true);
		expect(exact.perSegment[0]?.reason).toMatch(/sample-accurate/i);
		expect(nearest.requiresTranscode).toBe(false);
		expect(nearest.perSegment[0]?.reason).toMatch(/packet copy/i);
	});

	it('re-encodes an unknown video keyframe start instead of claiming lossless output', async () => {
		const source = makeSource('unknown', {
			keyframeState: 'unknown',
			keyframeTimestamps: []
		});
		const preflight = await preflightExport(
			[source],
			[createSegment(0.5, 1, { sourceId: source.id })],
			'nearestKeyframe',
			true
		);
		expect(preflight.requiresTranscode).toBe(true);
		expect(preflight.perSegment[0]?.reason).toMatch(/keyframe map unavailable/i);
	});

	it('re-encodes video with an unavailable frame rate', async () => {
		const source = makeSource('variable', { fps: null });
		const preflight = await preflightExport(
			[source],
			[createSegment(0, 1, { sourceId: source.id })],
			'nearestKeyframe',
			true
		);
		expect(preflight.requiresTranscode).toBe(true);
		expect(preflight.perSegment[0]?.reason).toMatch(/frame rate/i);
	});

	it('rejects a merged video and audio-only sequence before rendering', async () => {
		const video = makeSource('video');
		const audio = makeSource('audio', {
			name: 'audio.webm',
			mimeType: 'audio/webm',
			videoCodec: null,
			width: null,
			height: null,
			fps: null,
			keyframeTimestamps: [],
			keyframeState: 'audio-only',
			audioCodec: 'opus'
		});
		const preflight = await preflightExport(
			[video, audio],
			[createSegment(0, 1, { sourceId: video.id }), createSegment(0, 1, { sourceId: audio.id })],
			'nearestKeyframe',
			true
		);
		expect(preflight.eligible).toBe(false);
		expect(preflight.reason).toMatch(/video and audio-only/i);
	});
});

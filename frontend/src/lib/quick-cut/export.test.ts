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
});

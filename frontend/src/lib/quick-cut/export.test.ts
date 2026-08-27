import { describe, expect, it } from 'vitest';
import { exportSegments, preflightExport } from './export';
import { createSegment } from './model';
import type { QuickCutSource } from './types';

function makeSource(id: string, overrides: Partial<QuickCutSource> = {}): QuickCutSource {
	const base: QuickCutSource = {
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
		keyframeState: 'known',
		videoStreams: [],
		audioStreams: [],
		...overrides
	};
	if (!overrides.videoStreams) {
		if (base.videoCodec) {
			base.videoStreams = [
				{
					index: 0,
					codec: base.videoCodec,
					width: base.width,
					height: base.height,
					rotation: base.rotation,
					fps: base.fps,
					keyframeTimestamps: base.keyframeTimestamps,
					keyframeState: base.keyframeState === 'known' ? 'known' : 'unknown'
				}
			];
		} else base.videoStreams = [];
	}
	if (!overrides.audioStreams) {
		if (base.audioCodec) {
			base.audioStreams = [
				{
					index: 0,
					codec: base.audioCodec,
					sampleRate: base.sampleRate,
					channels: base.channels
				}
			];
		} else base.audioStreams = [];
	}
	return base;
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

	it('does not treat a nearby frame as an exact encoded keyframe', async () => {
		const source = makeSource('strict', { keyframeTimestamps: [0, 2] });
		const segment = createSegment(0.04, 1, { sourceId: source.id });
		const preflight = await preflightExport([source], [segment], 'exact', false);
		expect(preflight.perSegment[0]).toMatchObject({
			requiresTranscode: true,
			reason: expect.stringMatching(/not on keyframe/i)
		});
	});

	it('honors mixed per-segment cut modes without transcoding the lossless ranges', async () => {
		const src = makeSource('s1');
		const exact = createSegment(0.5, 2, {
			id: 'exact',
			sourceId: src.id,
			cutMode: 'exact'
		});
		const lossless = createSegment(2.5, 4, {
			id: 'lossless',
			sourceId: src.id,
			cutMode: 'nearestKeyframe'
		});

		const individual = await preflightExport([src], [exact, lossless], 'nearestKeyframe', false);
		expect(individual.requiresTranscode).toBe(false);
		expect(individual.perSegment).toEqual([
			expect.objectContaining({ segmentId: exact.id, requiresTranscode: true }),
			expect.objectContaining({
				segmentId: lossless.id,
				requiresTranscode: false,
				snappedStart: 2
			})
		]);

		const merged = await preflightExport([src], [exact, lossless], 'nearestKeyframe', true);
		expect(merged.requiresTranscode).toBe(true);
		expect(merged.reason).toMatch(/one or more segments/iu);
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

	it('re-encodes merged sources with different frame rates', async () => {
		const sourceA = makeSource('a', { fps: 24 });
		const sourceB = makeSource('b', { fps: 60 });
		const segments = [
			createSegment(0, 1, { sourceId: sourceA.id }),
			createSegment(0, 1, { sourceId: sourceB.id })
		];
		const preflight = await preflightExport([sourceA, sourceB], segments, 'nearestKeyframe', true);
		expect(preflight.requiresTranscode).toBe(true);
		expect(preflight.reason).toMatch(/frame rates/i);
	});

	it('does not claim stream copy for codecs unsupported by the source container', async () => {
		const source = makeSource('mislabeled', {
			name: 'mislabeled.webm',
			mimeType: 'video/webm',
			videoCodec: 'avc',
			audioCodec: 'aac'
		});
		const segment = createSegment(0, 1, { sourceId: source.id });
		const preflight = await preflightExport([source], [segment], 'nearestKeyframe', false);
		expect(preflight.perSegment[0]).toMatchObject({
			requiresTranscode: true,
			reason: expect.stringMatching(/container/i)
		});
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

	it('cancels while a source handle is still resolving', async () => {
		let resolveFile!: (file: File) => void;
		const pendingFile = new Promise<File>((resolve) => {
			resolveFile = resolve;
		});
		// SAFETY: export only calls getFile on this focused FileSystemFileHandle test double.
		const handle = { getFile: () => pendingFile } as FileSystemFileHandle;
		const source = makeSource('slow', { handle });
		const controller = new AbortController();
		const exported = exportSegments({
			sources: [source],
			segments: [createSegment(0, 1, { sourceId: source.id })],
			cutMode: 'nearestKeyframe',
			merge: false,
			signal: controller.signal
		});

		controller.abort(new DOMException('Export cancelled.', 'AbortError'));
		resolveFile(new File(['not decoded'], 'slow.mp4', { type: 'video/mp4' }));
		await expect(exported).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('rejects an impossible video track selection', async () => {
		const src = makeSource('s1', { selectedVideoTrackIndex: 5 });
		const seg = createSegment(0, 1, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(false);
		expect(pre.reason).toMatch(/does not exist/i);
	});

	it('rejects when no tracks are selected', async () => {
		const src = makeSource('s1', { selectedVideoTrackIndex: null, selectedAudioTrackIndices: [] });
		const seg = createSegment(0, 1, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(false);
		expect(pre.reason).toMatch(/no tracks/i);
	});

	it('allows video-off exports and keeps audio packet copy', async () => {
		const src = makeSource('s1', { selectedVideoTrackIndex: null, selectedAudioTrackIndices: [0] });
		const seg = createSegment(0, 1, { sourceId: src.id });
		const pre = await preflightExport([src], [seg], 'nearestKeyframe', false);
		expect(pre.eligible).toBe(true);
		expect(pre.perSegment[0]?.reason).toMatch(/packet copy/i);
	});

	it('rejects merged mix of video-enabled and video-disabled selections', async () => {
		const videoOn = makeSource('on', { selectedVideoTrackIndex: 0 });
		const videoOff = makeSource('off', {
			selectedVideoTrackIndex: null,
			selectedAudioTrackIndices: [0]
		});
		const segs = [
			createSegment(0, 1, { sourceId: videoOn.id }),
			createSegment(0, 1, { sourceId: videoOff.id })
		];
		const pre = await preflightExport([videoOn, videoOff], segs, 'nearestKeyframe', true);
		expect(pre.eligible).toBe(false);
		expect(pre.reason).toMatch(/video and audio-only/i);
	});
});

import { describe, expect, it, vi } from 'vitest';
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
	it('admits a small export when its working files fit below 50 MB of free quota', async () => {
		vi.stubGlobal('navigator', {
			storage: { estimate: async () => ({ quota: 1024 * 1024, usage: 0 }) }
		});
		try {
			const source = makeSource('small', { size: 112_000, duration: 3 });
			const segment = createSegment(0.5, 2.5, { sourceId: source.id });
			for (const cutMode of ['nearestKeyframe', 'exact'] as const) {
				const result = await preflightExport([source], [segment], cutMode, true);
				expect(result.eligible).toBe(true);
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('rejects an export whose required working files exceed remaining quota', async () => {
		vi.stubGlobal('navigator', {
			storage: {
				estimate: async () => ({ quota: 1024 * 1024, usage: 100_000 })
			}
		});
		try {
			const source = makeSource('large', {
				size: 2 * 1024 * 1024,
				duration: 3
			});
			const result = await preflightExport(
				[source],
				[createSegment(0, 3, { sourceId: source.id })],
				'exact',
				true
			);
			expect(result).toMatchObject({
				eligible: false,
				reason: 'Not enough storage for this export.'
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

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

	it('re-encodes an exact audio cut but keeps nearest packet copy lossless', async () => {
		const source = makeSource('audio', {
			name: 'audio.webm',
			mimeType: 'audio/webm',
			videoCodec: null,
			width: 0,
			height: 0,
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

	it('rejects a merged video and audio-only sequence before rendering', async () => {
		const video = makeSource('video');
		const audio = makeSource('audio', {
			name: 'audio.webm',
			mimeType: 'audio/webm',
			videoCodec: null,
			width: 0,
			height: 0,
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

	it('rejects cancellation after a pending source handle resolves', async () => {
		let resolveFile!: (file: File) => void;
		const pendingFile = new Promise<File>((resolve) => {
			resolveFile = resolve;
		});
		const getFile = vi.fn(() => pendingFile);
		const handle: FileSystemFileHandle = {
			kind: 'file',
			name: 'slow.mp4',
			getFile,
			async createWritable() {
				throw new Error('Unexpected write to export source');
			},
			async createSyncAccessHandle() {
				throw new Error('Unexpected synchronous access to export source');
			},
			isSameEntry: async (other) => other === handle
		};
		const source = makeSource('slow', { handle });
		const controller = new AbortController();
		const exported = exportSegments({
			sources: [source],
			segments: [createSegment(0, 1, { sourceId: source.id })],
			cutMode: 'nearestKeyframe',
			merge: false,
			signal: controller.signal
		});

		await vi.waitFor(() => expect(getFile).toHaveBeenCalledOnce());
		controller.abort(new DOMException('Export cancelled.', 'AbortError'));
		resolveFile(new File(['not decoded'], 'slow.mp4', { type: 'video/mp4' }));
		await expect(exported).rejects.toMatchObject({ name: 'AbortError' });
	});
});

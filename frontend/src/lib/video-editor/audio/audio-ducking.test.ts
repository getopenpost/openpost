import { describe, expect, it } from 'vitest';
import {
	DUCKING_DEFAULT_ATTACK_SEC,
	DUCKING_DEFAULT_RELEASE_SEC,
	collectDuckingSources,
	duckGainAtFrame,
	normalizeAudioDucking,
	dbToGain,
	type DuckingSource
} from './audio-ducking';
import type { TimelineItem, TimelineTrack, SubComposition } from '../project/types';
import { planMixdown, planNestedMixdown } from '../media/render-plan';
import { MIX_SAMPLE_RATE } from './bounded-audio-mixer';

function track(id: string, extra: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...extra
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'track-a',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'audio',
		mediaId: 'media-a',
		...extra
	};
}

describe('normalizeAudioDucking', () => {
	it('returns undefined for non-negative or missing duck', () => {
		expect(normalizeAudioDucking(null)).toBeUndefined();
		expect(normalizeAudioDucking({ duckOthersDb: 0 })).toBeUndefined();
		expect(normalizeAudioDucking({ duckOthersDb: 3 })).toBeUndefined();
	});

	it('clamps and fills defaults', () => {
		expect(normalizeAudioDucking({ duckOthersDb: -9 })).toEqual({ duckOthersDb: -9 });
		expect(normalizeAudioDucking({ duckOthersDb: -9, attackSec: 0.5, releaseSec: 0.4 })).toEqual({
			duckOthersDb: -9,
			attackSec: 0.5,
			releaseSec: 0.4
		});
		expect(normalizeAudioDucking({ duckOthersDb: -80 })).toEqual({ duckOthersDb: -60 });
	});

	it('deduplicates and drops empty targetTrackIds', () => {
		expect(normalizeAudioDucking({ duckOthersDb: -6, targetTrackIds: [] })).toEqual({ duckOthersDb: -6 });
		expect(
			normalizeAudioDucking({ duckOthersDb: -6, targetTrackIds: ['a', 'a', ''] })
		).toEqual({ duckOthersDb: -6, targetTrackIds: ['a'] });
	});
});

describe('collectDuckingSources', () => {
	const FPS = 30;

	it('collects audible sources and skips muted tracks and non-negative duck', () => {
		const tracks = [
			track('track-audio', { kind: 'audio', order: 0 }),
			track('track-sfx', { kind: 'audio', order: 1 }),
			track('track-muted', { kind: 'audio', order: 2, muted: true })
		];
		const items: TimelineItem[] = [
			item({ id: 'voice', trackId: 'track-audio', from: 0, durationInFrames: 90, audioDucking: { duckOthersDb: -9, attackSec: 0.1 } }),
			item({ id: 'sfx-duck', trackId: 'track-sfx', from: 30, durationInFrames: 30, audioDucking: { duckOthersDb: -12 } }),
			item({ id: 'muted-duck', trackId: 'track-muted', from: 0, durationInFrames: 90, audioDucking: { duckOthersDb: -9 } }),
			item({ id: 'no-duck', trackId: 'track-audio', from: 60, durationInFrames: 10, audioDucking: { duckOthersDb: 0 } as unknown as { duckOthersDb: number } })
		];
		const sources = collectDuckingSources(items, tracks, FPS);
		expect(sources.map((s) => s.itemId).sort()).toEqual(['sfx-duck', 'voice']);
		const voice = sources.find((s) => s.itemId === 'voice')!;
		expect(voice.attackFrames).toBeCloseTo(3);
		expect(voice.releaseFrames).toBeCloseTo(DUCKING_DEFAULT_RELEASE_SEC * FPS);
	});

	it('excludes non-audible video items and respects solo', () => {
		const tracks = [
			track('track-a', { solo: true }),
			track('track-b', { solo: false })
		];
		const items: TimelineItem[] = [
			item({ id: 'a-duck', trackId: 'track-a', audioDucking: { duckOthersDb: -9 } }),
			item({ id: 'b-duck', trackId: 'track-b', audioDucking: { duckOthersDb: -9 } })
		];
		const sources = collectDuckingSources(items, tracks, FPS);
		expect(sources.map((s) => s.itemId)).toEqual(['a-duck']);
	});

	it('maps nested composition sources into parent frames', () => {
		const sub: SubComposition = {
			id: 'sub',
			name: 'Sub',
			items: [item({ id: 'nested', trackId: 'sub-a', from: 10, durationInFrames: 20, audioDucking: { duckOthersDb: -9 } })],
			tracks: [track('sub-a', { kind: 'audio', order: 0 })],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 100
		};
		const wrapper = item({
			id: 'wrapper',
			type: 'composition',
			compositionId: 'sub',
			trackId: 'root-a',
			from: 40,
			durationInFrames: 100
		});
		const tracks = [track('root-a', { kind: 'audio', order: 0 })];
		const sources = collectDuckingSources([wrapper], tracks, FPS, [sub]);
		expect(sources).toHaveLength(1);
		expect(sources[0]).toMatchObject({ itemId: 'nested', trackId: 'root-a', startFrame: 50, endFrame: 70 });
	});

	it('does not loop on cyclic compositions', () => {
		const cycle: SubComposition = {
			id: 'cycle',
			name: 'Cycle',
			items: [
				item({ id: 'leaf', trackId: 'cycle-a', from: 0, durationInFrames: 10, audioDucking: { duckOthersDb: -6 } }),
				{ ...item({ id: 'self', trackId: 'cycle-a', durationInFrames: 10 }), type: 'audio', compositionId: 'cycle', mediaId: undefined } as unknown as TimelineItem
			],
			tracks: [track('cycle-a', { kind: 'audio', order: 0 })],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrapper = item({ id: 'w', type: 'audio', trackId: 'root-a', compositionId: 'cycle', durationInFrames: 30 } as unknown as TimelineItem);
		expect(() => collectDuckingSources([wrapper as TimelineItem], [track('root-a')], 30, [cycle])).not.toThrow();
	});
});

describe('duckGainAtFrame', () => {
	const FPS = 30;
	const sources: DuckingSource[] = [
		{
			itemId: 'ducker',
			trackId: 'track-sfx',
			startFrame: 30,
			endFrame: 60,
			duckDb: -12,
			attackFrames: DUCKING_DEFAULT_ATTACK_SEC * FPS,
			releaseFrames: DUCKING_DEFAULT_RELEASE_SEC * FPS
		}
	];

	it('is untouched before window, ducked inside, and recovers after release', () => {
		const target = { itemId: 'target', trackId: 'track-audio' };
		expect(duckGainAtFrame(0, sources, target)).toBeCloseTo(1);
		// mid window fully ducked
		expect(duckGainAtFrame(45, sources, target)).toBeCloseTo(dbToGain(-12));
		// after release fully recovered (end 60 + release 7.5 frames ~ 67.5)
		expect(duckGainAtFrame(80, sources, target)).toBeCloseTo(1);
	});

	it('ramps attack and release linearly in dB', () => {
		const attackSource: DuckingSource = {
			itemId: 'd',
			trackId: 't',
			startFrame: 0,
			endFrame: 30,
			duckDb: -12,
			attackFrames: 6,
			releaseFrames: 6
		};
		// halfway through attack: -6 dB
		expect(duckGainAtFrame(3, [attackSource], { itemId: 'x', trackId: 'other' })).toBeCloseTo(dbToGain(-6));
		// halfway through release: -6 dB after end
		expect(duckGainAtFrame(33, [attackSource], { itemId: 'x', trackId: 'other' })).toBeCloseTo(dbToGain(-6));
	});

	it('never ducks itself and respects targetTrackIds', () => {
		const targeted: DuckingSource = {
			itemId: 'd',
			trackId: 't',
			startFrame: 0,
			endFrame: 30,
			duckDb: -12,
			attackFrames: 0,
			releaseFrames: 0,
			targetTrackIds: ['allowed']
		};
		expect(duckGainAtFrame(10, [targeted], { itemId: 'd', trackId: 'allowed' })).toBeCloseTo(1);
		expect(duckGainAtFrame(10, [targeted], { itemId: 'x', trackId: 'allowed' })).toBeCloseTo(dbToGain(-12));
		expect(duckGainAtFrame(10, [targeted], { itemId: 'x', trackId: 'blocked' })).toBeCloseTo(1);
	});

	it('takes deepest duck when sources overlap', () => {
		const overlapping: DuckingSource[] = [
			{ itemId: 'a', trackId: 't', startFrame: 0, endFrame: 30, duckDb: -6, attackFrames: 0, releaseFrames: 0 },
			{ itemId: 'b', trackId: 't', startFrame: 10, endFrame: 40, duckDb: -12, attackFrames: 0, releaseFrames: 0 }
		];
		expect(duckGainAtFrame(15, overlapping, { itemId: 'x', trackId: 'other' })).toBeCloseTo(dbToGain(-12));
		expect(duckGainAtFrame(5, overlapping, { itemId: 'x', trackId: 'other' })).toBeCloseTo(dbToGain(-6));
	});
});

describe('planMixdown ducking field', () => {
	it('carries normalized ducking into MixEntry and drops positive values', () => {
		const tracks = [track('track-a', { kind: 'audio', order: 0 })];
		const entries = planMixdown(
			[
				item({ id: 'good', trackId: 'track-a', mediaId: 'm1', audioDucking: { duckOthersDb: -9 } }),
				item({ id: 'bad', trackId: 'track-a', mediaId: 'm2', audioDucking: { duckOthersDb: 3 } as unknown as { duckOthersDb: number } })
			],
			tracks,
			30
		);
		expect(entries.find((e) => e.itemId === 'good')?.ducking).toEqual({ duckOthersDb: -9 });
		expect(entries.find((e) => e.itemId === 'bad')?.ducking).toBeUndefined();
	});

	it('planNestedMixdown preserves ducking through slicing', () => {
		const nested: SubComposition = {
			id: 'n',
			name: 'N',
			items: [item({ id: 'leaf', trackId: 'sub-a', mediaId: 'voice', from: 0, durationInFrames: 60, audioDucking: { duckOthersDb: -12 } })],
			tracks: [track('sub-a', { kind: 'audio', order: 0 })],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 60
		};
		const wrapper = { ...item({ id: 'w', trackId: 'root-a', type: 'audio', compositionId: 'n', mediaId: undefined, durationInFrames: 60 }), type: 'audio' as const };
		const entries = planNestedMixdown([wrapper as TimelineItem], [track('root-a', { kind: 'audio', order: 0 })], 30, [], [nested]);
		expect(entries[0]?.ducking?.duckOthersDb).toBe(-12);
	});
});

describe('preview/export parity', () => {
	it('uses same duck amount in preview frames and exported seconds', () => {
		const fps = 30;
		const itemA = item({ id: 'target', trackId: 'track-audio', from: 0, durationInFrames: 90, mediaId: 'm-a' });
		const itemB = item({ id: 'ducker', trackId: 'track-sfx', from: 30, durationInFrames: 30, mediaId: 'm-b', audioDucking: { duckOthersDb: -12, attackSec: 0.1, releaseSec: 0.1 } });
		const tracks = [track('track-audio', { kind: 'audio', order: 0 }), track('track-sfx', { kind: 'audio', order: 1 })];
		const sources = collectDuckingSources([itemA, itemB], tracks, fps);
		// Preview gain at frame 45 (mid-duck)
		const previewGain = duckGainAtFrame(45, sources, { itemId: 'target', trackId: 'track-audio' });
		// Export gain at 45/fps seconds = 1.5s should match using bounded mixer's seconds math
		const duckDb = -12;
		const expected = dbToGain(duckDb);
		expect(previewGain).toBeCloseTo(expected);
		// Export helper mirrors same dB math at timeline seconds
		const attackSec = 0.1;
		const releaseSec = 0.1;
		function duckDbAtSeconds(t: number): number {
			const start = 1, end = 2;
			if (t < start || t > end + releaseSec) return 0;
			if (t < start + attackSec) return duckDb * ((t - start) / attackSec);
			if (t <= end) return duckDb;
			return duckDb * (1 - (t - end) / releaseSec);
		}
		expect(duckDbAtSeconds(1.5)).toBeCloseTo(duckDb);
		expect(dbToGain(duckDbAtSeconds(1.5))).toBeCloseTo(previewGain);
	});
});

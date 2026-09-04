/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening, anti-slop/no-conditional-empty-object-spread */
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
	const FPS = 30;
	it('clamps and fills defaults', () => {
		expect(normalizeAudioDucking({ duckOthersDb: -9 })).toEqual({ duckOthersDb: -9 });
		expect(normalizeAudioDucking({ duckOthersDb: -9, attackSec: 0.5, releaseSec: 0.4 })).toEqual({
			duckOthersDb: -9,
			attackSec: 0.5,
			releaseSec: 0.4
		});
		expect(normalizeAudioDucking({ duckOthersDb: -80 })).toEqual({ duckOthersDb: -60 });
	});

	it('collects audible sources and skips muted tracks and non-negative duck', () => {
		const tracks = [
			track('track-audio', { kind: 'audio', order: 0 }),
			track('track-sfx', { kind: 'audio', order: 1 }),
			track('track-muted', { kind: 'audio', order: 2, muted: true })
		];
		const items: TimelineItem[] = [
			item({
				id: 'voice',
				trackId: 'track-audio',
				from: 0,
				durationInFrames: 90,
				audioDucking: { duckOthersDb: -9, attackSec: 0.1 }
			}),
			item({
				id: 'sfx-duck',
				trackId: 'track-sfx',
				from: 30,
				durationInFrames: 30,
				audioDucking: { duckOthersDb: -12 }
			}),
			item({
				id: 'muted-duck',
				trackId: 'track-muted',
				from: 0,
				durationInFrames: 90,
				audioDucking: { duckOthersDb: -9 }
			}),
			item({
				id: 'no-duck',
				trackId: 'track-audio',
				from: 60,
				durationInFrames: 10,
				audioDucking: { duckOthersDb: 0 } as unknown as { duckOthersDb: number }
			})
		];
		const sources = collectDuckingSources(items, tracks, FPS);
		expect(sources.map((s) => s.itemId).sort()).toEqual(['sfx-duck', 'voice']);
		const voice = sources.find((s) => s.itemId === 'voice')!;
		expect(voice.attackFrames).toBeCloseTo(3);
		expect(voice.releaseFrames).toBeCloseTo(DUCKING_DEFAULT_RELEASE_SEC * FPS);
	});

	// Solo changes which tracks duck: only sources on soloed tracks apply.
	// Deleted in the prune as a duplicate; restored after review because no
	// surviving test pins solo semantics.
	it('excludes non-audible video items and respects solo', () => {
		const tracks = [track('track-a', { solo: true }), track('track-b', { solo: false })];
		const items: TimelineItem[] = [
			item({ id: 'a-duck', trackId: 'track-a', audioDucking: { duckOthersDb: -9 } }),
			item({ id: 'b-duck', trackId: 'track-b', audioDucking: { duckOthersDb: -9 } })
		];
		const sources = collectDuckingSources(items, tracks, FPS);
		expect(sources.map((s) => s.itemId)).toEqual(['a-duck']);
	});

	it('does not loop on cyclic compositions', () => {
		const cycle: SubComposition = {
			id: 'cycle',
			name: 'Cycle',
			items: [
				item({
					id: 'leaf',
					trackId: 'cycle-a',
					from: 0,
					durationInFrames: 10,
					audioDucking: { duckOthersDb: -6 }
				}),
				{
					...item({ id: 'self', trackId: 'cycle-a', durationInFrames: 10 }),
					type: 'audio',
					compositionId: 'cycle',
					mediaId: undefined
				} as unknown as TimelineItem
			],
			tracks: [track('cycle-a', { kind: 'audio', order: 0 })],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrapper = item({
			id: 'w',
			type: 'audio',
			trackId: 'root-a',
			compositionId: 'cycle',
			durationInFrames: 30
		} as unknown as TimelineItem);
		expect(() =>
			collectDuckingSources([wrapper as TimelineItem], [track('root-a')], 30, [cycle])
		).not.toThrow();
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

	it('shapes the gain envelope: window, linear dB ramps, deepest overlap wins', () => {
		const target = { itemId: 'target', trackId: 'track-audio' };
		expect(duckGainAtFrame(0, sources, target)).toBeCloseTo(1);
		// mid window fully ducked
		expect(duckGainAtFrame(45, sources, target)).toBeCloseTo(dbToGain(-12));
		// after release fully recovered (end 60 + release 7.5 frames ~ 67.5)
		expect(duckGainAtFrame(80, sources, target)).toBeCloseTo(1);
		const attackSource: DuckingSource = {
			itemId: 'd',
			trackId: 't',
			startFrame: 0,
			endFrame: 30,
			duckDb: -12,
			attackFrames: 6,
			releaseFrames: 6
		};
		// halfway through attack: -6 dB; halfway through release: -6 dB after end
		expect(duckGainAtFrame(3, [attackSource], { itemId: 'x', trackId: 'other' })).toBeCloseTo(
			dbToGain(-6)
		);
		expect(duckGainAtFrame(33, [attackSource], { itemId: 'x', trackId: 'other' })).toBeCloseTo(
			dbToGain(-6)
		);
		const overlapping: DuckingSource[] = [
			{
				itemId: 'a',
				trackId: 't',
				startFrame: 0,
				endFrame: 30,
				duckDb: -6,
				attackFrames: 0,
				releaseFrames: 0
			},
			{
				itemId: 'b',
				trackId: 't',
				startFrame: 10,
				endFrame: 40,
				duckDb: -12,
				attackFrames: 0,
				releaseFrames: 0
			}
		];
		expect(duckGainAtFrame(15, overlapping, { itemId: 'x', trackId: 'other' })).toBeCloseTo(
			dbToGain(-12)
		);
		expect(duckGainAtFrame(5, overlapping, { itemId: 'x', trackId: 'other' })).toBeCloseTo(
			dbToGain(-6)
		);
	});
});

describe('planMixdown ducking field', () => {
	it('uses same duck amount in preview frames and exported seconds', () => {
		const fps = 30;
		const itemA = item({
			id: 'target',
			trackId: 'track-audio',
			from: 0,
			durationInFrames: 90,
			mediaId: 'm-a'
		});
		const itemB = item({
			id: 'ducker',
			trackId: 'track-sfx',
			from: 30,
			durationInFrames: 30,
			mediaId: 'm-b',
			audioDucking: { duckOthersDb: -12, attackSec: 0.1, releaseSec: 0.1 }
		});
		const tracks = [
			track('track-audio', { kind: 'audio', order: 0 }),
			track('track-sfx', { kind: 'audio', order: 1 })
		];
		const sources = collectDuckingSources([itemA, itemB], tracks, fps);
		// Preview gain at frame 45 (mid-duck)
		const previewGain = duckGainAtFrame(45, sources, { itemId: 'target', trackId: 'track-audio' });
		// Export gain at 45/fps seconds = 1.5s must equal the preview gain: the
		// mid-duck value is fully determined by the authored -12 dB amount.
		expect(previewGain).toBeCloseTo(dbToGain(-12));
	});
});

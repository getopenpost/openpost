/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening */
import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { planMixdown, planNestedMixdown, sliceMixEntries } from '../media/render-plan';
import { collectMixEntryDuckWindows, mixEntryDuckGainAtTime, dbToGain } from './audio-ducking';

function track(id: string, order = 0, extra: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...extra
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'track-a',
		from: 0,
		durationInFrames: 60,
		label: '',
		type: 'audio',
		mediaId: 'media-a',
		...extra
	};
}

describe('MixEntry duck window is authored, not transition-extended', () => {
	it('maps duck windows through nesting transforms (source-window clip, speed)', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub',
			name: 'Sub',
			items: [
				item({
					id: 'leaf',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 60,
					mediaId: 'media-leaf',
					audioDucking: { duckOthersDb: -9 }
				})
			],
			tracks: [track('sub-a', 0)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 60
		};
		const wrapper = item({
			id: 'wrapper',
			type: 'composition',
			compositionId: 'sub',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 30,
			sourceStart: 10,
			sourceEnd: 40,
			mediaId: undefined
		}) as TimelineItem;
		const entries = planNestedMixdown([wrapper], [track('root-a', 0)], fps, [], [sub]);
		expect(entries).toHaveLength(1);
		const e = entries[0]!;
		// Duck window is translated, not clamped, so it can be negative when slice starts mid-window
		expect(e.duckStartSeconds).toBeCloseTo(-10 / fps);
		expect(e.duckEndSeconds).toBeCloseTo(50 / fps);
		expect(e.whenSeconds).toBeCloseTo(0);
		expect(e.durationSeconds).toBeCloseTo(30 / fps);

		// Wrapper speed scales the duck window with the media: leaf duration
		// 30 frames = 1s, wrapper speed 2 halves duration to 0.5s, duck window
		// also halved, so a target is ducked at 0.25s but free at 0.6s.
		const fastSub: SubComposition = {
			...sub,
			items: [
				item({
					id: 'leaf',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-leaf',
					audioDucking: { duckOthersDb: -12, attackSec: 0, releaseSec: 0 }
				})
			],
			durationInFrames: 30
		};
		const fastWrapper = item({
			id: 'wrapper',
			type: 'composition',
			compositionId: 'sub',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 15,
			speed: 2,
			sourceStart: 0,
			mediaId: undefined
		}) as TimelineItem;
		const fastEntries = planNestedMixdown([fastWrapper], [track('root-a', 0)], fps, [], [fastSub]);
		const fastEntry = fastEntries[0]!;
		expect(fastEntry.duckStartSeconds).toBeCloseTo(0);
		expect(fastEntry.duckEndSeconds).toBeCloseTo(0.5);
		expect(fastEntry.durationSeconds).toBeCloseTo(0.5);
		const target = item({
			id: 'target',
			trackId: 'root-b',
			from: 0,
			durationInFrames: 60,
			mediaId: 'media-target'
		});
		const targetEntries = planMixdown([target], [track('root-a', 0), track('root-b', 1)], fps, []);
		const all = [...fastEntries, ...targetEntries];
		const allWindows = collectMixEntryDuckWindows(all);
		const targetEntry = all.find((x) => x.itemId === 'target')!;
		expect(mixEntryDuckGainAtTime(0.25, targetEntry, allWindows)).toBeCloseTo(dbToGain(-12));
		expect(mixEntryDuckGainAtTime(0.6, targetEntry, allWindows)).toBeCloseTo(1);
	});
});

describe('root-to-nested and nested-to-root preview parity via MixEntry plan', () => {
	it('uses one shared plan so root and nested duck each other like export', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub',
			name: 'Sub',
			items: [
				item({
					id: 'nested-voice',
					trackId: 'sub-a',
					from: 10,
					durationInFrames: 30,
					mediaId: 'media-nested',
					audioDucking: { duckOthersDb: -9, attackSec: 0, releaseSec: 0 }
				})
			],
			tracks: [track('sub-a', 0)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 60
		};
		const wrapper = item({
			id: 'wrapper',
			type: 'composition',
			compositionId: 'sub',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 60,
			mediaId: undefined
		}) as TimelineItem;
		const rootMusic = item({
			id: 'root-music',
			trackId: 'root-b',
			from: 0,
			durationInFrames: 60,
			mediaId: 'media-root'
		});
		const rootDucker = item({
			id: 'root-ducker',
			trackId: 'root-c',
			from: 0,
			durationInFrames: 20,
			mediaId: 'media-ducker',
			audioDucking: { duckOthersDb: -12, attackSec: 0, releaseSec: 0 }
		});
		const plan = planNestedMixdown(
			[wrapper, rootMusic, rootDucker],
			[track('root-a', 0), track('root-b', 1), track('root-c', 2)],
			fps,
			[],
			[sub]
		);
		const windows = collectMixEntryDuckWindows(plan);
		const nestedEntry = plan.find((e) => e.itemId === 'wrapper/nested-voice')!;
		const rootMusicEntry = plan.find((e) => e.itemId === 'root-music')!;
		const rootDuckerEntry = plan.find((e) => e.itemId === 'root-ducker')!;
		expect(mixEntryDuckGainAtTime(0.5, rootMusicEntry, windows)).toBeCloseTo(dbToGain(-12));
		expect(mixEntryDuckGainAtTime(0.5, nestedEntry, windows)).toBeCloseTo(dbToGain(-12));
		// Self-exclusion: nested does not duck itself, root ducker does not duck itself
		expect(
			mixEntryDuckGainAtTime(
				0.5,
				nestedEntry,
				windows.filter((w) => w.itemId === nestedEntry.itemId)
			)
		).toBe(1);
		expect(
			mixEntryDuckGainAtTime(
				0.5,
				rootDuckerEntry,
				windows.filter((w) => w.itemId === rootDuckerEntry.itemId)
			)
		).toBe(1);
	});
});

describe('slice preserves original envelope phase', () => {
	it('translates attack when range begins mid-window, including negative start', () => {
		const fps = 30;
		const entry = {
			itemId: 'a',
			trackId: 'track-a',
			whenSeconds: 0,
			durationSeconds: 2,
			ducking: { duckOthersDb: -12, attackSec: 0.5, releaseSec: 0.2 },
			duckStartSeconds: 1,
			duckEndSeconds: 2,
			gainPoints: [{ whenSeconds: 0, value: 1 }],
			previewGainPoints: [{ whenSeconds: 0, value: 1 }],
			mixerTrackGain: 1,
			transitionGainSpans: [],
			sourceOffsetSeconds: 0,
			playbackRate: 1,
			pitchShiftSemitones: 0,
			audioEqStages: [],
			reversed: false,
			mediaId: 'm-a'
		} as unknown as import('../media/render-plan').MixEntry;
		const sliced = sliceMixEntries([entry], 1.3, 2.5);
		expect(sliced).toHaveLength(1);
		const s = sliced[0]!;
		// Original duck 1..2, attack 0.5, so at 1.3 gain is -12 * 0.3/0.5 = -7.2dB. Sliced window is translated to -0.3..0.7 in slice coords, preserving phase.
		expect(s.duckStartSeconds).toBeCloseTo(-0.3);
		expect(s.duckEndSeconds).toBeCloseTo(0.7);
		const windows = collectMixEntryDuckWindows(sliced);
		const target = {
			itemId: 'b',
			trackId: 'track-b',
			whenSeconds: 0,
			durationSeconds: 2,
			ducking: undefined
		} as unknown as import('../media/render-plan').MixEntry;
		// At slice local 0 (original 1.3), gain should be attack phase -7.2dB
		expect(mixEntryDuckGainAtTime(0, target, windows)).toBeCloseTo(dbToGain(-7.2), 2);
		// Original gain at 1.3 should match sliced gain at 0
		const origEntry = {
			...entry,
			whenSeconds: 0,
			durationSeconds: 2
		} as unknown as import('../media/render-plan').MixEntry;
		const origWindows = collectMixEntryDuckWindows([origEntry]);
		expect(mixEntryDuckGainAtTime(1.3, target, origWindows)).toBeCloseTo(
			mixEntryDuckGainAtTime(0, target, windows),
			5
		);
	});

	it('nested sibling targeting works via namespaced child track', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub',
			name: 'Sub',
			items: [
				item({
					id: 'sibling-ducker',
					trackId: 'sub-b',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-ducker',
					audioDucking: { duckOthersDb: -12, targetTrackIds: ['sub-a'] }
				}),
				item({
					id: 'sibling-target',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-target'
				})
			],
			tracks: [track('sub-a', 0), track('sub-b', 1)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrapper = item({
			id: 'wrapper',
			type: 'composition',
			compositionId: 'sub',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 30,
			mediaId: undefined
		}) as TimelineItem;
		const plan = planNestedMixdown([wrapper], [track('root-a', 0)], fps, [], [sub]);
		const ducker = plan.find((e) => e.itemId === 'wrapper/sibling-ducker')!;
		const target = plan.find((e) => e.itemId === 'wrapper/sibling-target')!;
		const windows = collectMixEntryDuckWindows(plan);
		// Sibling ducker targets sub-a via namespaced wrapper/sub-a, so it should duck target
		expect(mixEntryDuckGainAtTime(0.5, target, windows)).toBeCloseTo(dbToGain(-12));
		// Non-ducking target has alias, so it can be matched
		expect(target.duckTrackAliases).toContain('wrapper/sub-a');
		// Ducker itself has alias for its own track
		expect(ducker.duckTrackAliases).toContain('wrapper/sub-b');
	});
});

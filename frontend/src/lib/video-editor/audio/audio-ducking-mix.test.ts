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
	it('does not extend duck window with transition overlap', () => {
		const fps = 30;
		const tracks = [track('track-a', 0), track('track-b', 1)];
		const left = item({
			id: 'left',
			trackId: 'track-a',
			from: 0,
			durationInFrames: 30,
			mediaId: 'media-left',
			audioDucking: { duckOthersDb: -12 }
		});
		const right = item({
			id: 'right',
			trackId: 'track-a',
			from: 30,
			durationInFrames: 30,
			mediaId: 'media-right'
		});
		const transition = {
			id: 't',
			type: 'crossfade' as const,
			fromItemId: 'left',
			toItemId: 'right',
			durationInFrames: 10
		};
		const entries = planMixdown([left, right], tracks, fps, [transition]);
		const leftEntry = entries.find((e) => e.itemId === 'left')!;
		expect(leftEntry).toBeDefined();
		expect(leftEntry.duckStartSeconds).toBe(left.from / fps);
		expect(leftEntry.duckEndSeconds).toBe((left.from + left.durationInFrames) / fps);
		// target in the transition overlap after left end but before duck release should not be ducked if outside authored window + release
		const windows = collectMixEntryDuckWindows(entries);
		const target = entries.find((e) => e.itemId === 'right')!;
		// At time 1.05s (31.5 frames) which is inside transition overlap but outside left authored window (0..1s) + release 0.25s => up to 1.25s still ducked, but beyond 1.25 not
		// Pick time 1.4s which is after release
		expect(mixEntryDuckGainAtTime(1.4, target, windows)).toBeCloseTo(1);
		// Inside authored window, duck applies
		expect(mixEntryDuckGainAtTime(0.5, target, windows)).toBeCloseTo(dbToGain(-12));
	});
});

describe('nested duck windows are clipped and speed-mapped', () => {
	it('clips duck window to wrapper source window', () => {
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
	});

	it('speed-maps duck window with wrapper speed', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub',
			name: 'Sub',
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
			tracks: [track('sub-a', 0)],
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
			durationInFrames: 15,
			speed: 2,
			sourceStart: 0,
			mediaId: undefined
		}) as TimelineItem;
		const entries = planNestedMixdown([wrapper], [track('root-a', 0)], fps, [], [sub]);
		const e = entries[0]!;
		// leaf duration 30 frames =1s, wrapper speed 2 halves duration to 0.5s, duck window also halved
		expect(e.duckStartSeconds).toBeCloseTo(0);
		expect(e.duckEndSeconds).toBeCloseTo(0.5);
		expect(e.durationSeconds).toBeCloseTo(0.5);
		const windows = collectMixEntryDuckWindows(entries);
		// Need a target on another track to test duck at 0.25s vs 0.6s
		const target = item({
			id: 'target',
			trackId: 'root-b',
			from: 0,
			durationInFrames: 60,
			mediaId: 'media-target'
		});
		const targetEntries = planMixdown([target], [track('root-a', 0), track('root-b', 1)], fps, []);
		const all = [...entries, ...targetEntries];
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
		// Preview would use same plan, so parity holds
		const previewGainRootMusic = mixEntryDuckGainAtTime(0.5, rootMusicEntry, windows);
		const exportGainRootMusic = mixEntryDuckGainAtTime(0.5, rootMusicEntry, windows);
		expect(previewGainRootMusic).toBe(exportGainRootMusic);
	});
});

describe('self-exclusion', () => {
	it('does not duck itself even when overlapping with self window', () => {
		const fps = 30;
		const itemA = item({
			id: 'a',
			trackId: 'track-a',
			from: 0,
			durationInFrames: 60,
			mediaId: 'media-a',
			audioDucking: { duckOthersDb: -12 }
		});
		const entries = planMixdown([itemA], [track('track-a', 0)], fps, []);
		const windows = collectMixEntryDuckWindows(entries);
		const entry = entries[0]!;
		expect(mixEntryDuckGainAtTime(0.5, entry, windows)).toBe(1);
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

	it('retains release tail when authored duck end is before range start', () => {
		const fps = 30;
		const entry = {
			itemId: 'a',
			trackId: 'track-a',
			whenSeconds: 0,
			durationSeconds: 2,
			ducking: { duckOthersDb: -12, attackSec: 0, releaseSec: 0.5 },
			duckStartSeconds: 0.5,
			duckEndSeconds: 1,
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
		const sliced = sliceMixEntries([entry], 1.2, 2.5);
		expect(sliced).toHaveLength(1);
		const s = sliced[0]!;
		expect(s.duckStartSeconds).toBeCloseTo(-0.7);
		expect(s.duckEndSeconds).toBeCloseTo(-0.2);
		const windows = collectMixEntryDuckWindows(sliced);
		const target = {
			itemId: 'b',
			trackId: 'track-b'
		} as unknown as import('../media/render-plan').MixEntry;
		// At slice local 0 (original 1.2), we are in release: duckEnd 1, release 0.5, so progress (1.2-1)/0.5=0.4, db = -12*(1-0.4)=-7.2
		expect(mixEntryDuckGainAtTime(0, target, windows)).toBeCloseTo(dbToGain(-7.2), 2);
	});

	it('drops window when authored window plus release does not intersect slice', () => {
		const entry = {
			itemId: 'a',
			trackId: 'track-a',
			whenSeconds: 0,
			durationSeconds: 2,
			ducking: { duckOthersDb: -12, attackSec: 0, releaseSec: 0.1 },
			duckStartSeconds: 0,
			duckEndSeconds: 0.5,
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
		const sliced = sliceMixEntries([entry], 1, 2);
		expect(sliced).toHaveLength(1);
		// duckEnd+release =0.6 <1, so no intersect, duck should be dropped
		expect(sliced[0]!.ducking).toBeUndefined();
	});
});

describe('namespaced nested duck-track aliases', () => {
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

	it('non-ducking nested target still has aliases', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub2',
			name: 'Sub2',
			items: [
				item({
					id: 'music',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-music'
				})
			],
			tracks: [track('sub-a', 0)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrapper = item({
			id: 'w2',
			type: 'composition',
			compositionId: 'sub2',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 30,
			mediaId: undefined
		}) as TimelineItem;
		const plan = planNestedMixdown([wrapper], [track('root-a', 0)], fps, [], [sub]);
		const entry = plan[0]!;
		expect(entry.duckTrackAliases).toContain('root-a');
		expect(entry.duckTrackAliases).toContain('w2/sub-a');
	});

	it('duplicate instances cannot cross-target via raw child IDs', () => {
		const fps = 30;
		const subWithDucker: SubComposition = {
			id: 'sub3',
			name: 'Sub3',
			items: [
				item({
					id: 'ducker',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-ducker',
					audioDucking: { duckOthersDb: -12, targetTrackIds: ['sub-a'] }
				}),
				item({
					id: 'target',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-target'
				})
			],
			tracks: [track('sub-a', 0)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const subWithoutDucker: SubComposition = {
			id: 'sub3b',
			name: 'Sub3b',
			items: [
				item({
					id: 'target',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-target'
				})
			],
			tracks: [track('sub-a', 0)],
			transitions: [],
			fps,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrapper1 = item({
			id: 'w1',
			type: 'composition',
			compositionId: 'sub3',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 30,
			mediaId: undefined
		}) as TimelineItem;
		const wrapper2 = item({
			id: 'w2',
			type: 'composition',
			compositionId: 'sub3b',
			trackId: 'root-b',
			from: 0,
			durationInFrames: 30,
			mediaId: undefined
		}) as TimelineItem;
		const plan = planNestedMixdown(
			[wrapper1, wrapper2],
			[track('root-a', 0), track('root-b', 1)],
			fps,
			[],
			[subWithDucker, subWithoutDucker]
		);
		const target2 = plan.find((e) => e.itemId === 'w2/target')!;
		const windows = collectMixEntryDuckWindows(plan);
		// w1 ducker targets w1/sub-a, should not duck w2/target which is w2/sub-a (different wrapper) and w2 has no ducker of its own
		expect(mixEntryDuckGainAtTime(0.5, target2, windows)).toBe(1);
		const target1 = plan.find((e) => e.itemId === 'w1/target')!;
		expect(mixEntryDuckGainAtTime(0.5, target1, windows)).toBeCloseTo(dbToGain(-12));
	});

	it('root targeting wrapper track reaches all nested audio', () => {
		const fps = 30;
		const sub: SubComposition = {
			id: 'sub4',
			name: 'Sub4',
			items: [
				item({
					id: 'nested-music',
					trackId: 'sub-a',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-nested'
				}),
				item({
					id: 'nested-music2',
					trackId: 'sub-b',
					from: 0,
					durationInFrames: 30,
					mediaId: 'media-nested2'
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
			id: 'wrap',
			type: 'composition',
			compositionId: 'sub4',
			trackId: 'root-a',
			from: 0,
			durationInFrames: 30,
			mediaId: undefined
		}) as TimelineItem;
		const rootDucker = item({
			id: 'root-ducker',
			trackId: 'root-b',
			from: 0,
			durationInFrames: 30,
			mediaId: 'media-ducker',
			audioDucking: { duckOthersDb: -9, targetTrackIds: ['root-a'] }
		});
		const plan = planNestedMixdown(
			[wrapper, rootDucker],
			[track('root-a', 0), track('root-b', 1)],
			fps,
			[],
			[sub]
		);
		const windows = collectMixEntryDuckWindows(plan);
		const nested1 = plan.find((e) => e.itemId === 'wrap/nested-music')!;
		const nested2 = plan.find((e) => e.itemId === 'wrap/nested-music2')!;
		expect(mixEntryDuckGainAtTime(0.5, nested1, windows)).toBeCloseTo(dbToGain(-9));
		expect(mixEntryDuckGainAtTime(0.5, nested2, windows)).toBeCloseTo(dbToGain(-9));
	});
});

describe('compiled duck evaluation is bounded', () => {
	it('does not rescan all windows per sample', async () => {
		const { CompiledTargetDuck } = await import('./bounded-audio-mixer');
		const fps = 30;
		// Create 10 duck windows staggered
		const windows = Array.from({ length: 10 }, (_, i) => ({
			itemId: `ducker-${i}`,
			trackId: `track-ducker-${i}`,
			startSeconds: i * 0.5,
			endSeconds: i * 0.5 + 0.4,
			duckDb: -12,
			attackSeconds: 0.05,
			releaseSeconds: 0.1,
			targetTrackIds: undefined
		}));
		const target = { itemId: 'target', trackId: 'track-target' };
		const compiled = new CompiledTargetDuck(windows, target);
		const totalSamples = 48000 * 2;
		for (let s = 0; s < totalSamples; s++) {
			const t = s / 48000;
			compiled.gainAt(t);
		}
		// Naive would be totalSamples * windows.length = 480k
		// Compiled should be much less: each window is active only for ~0.5s, so at most 1-2 active per sample, so evaluations ~ totalSamples * avgActive (1-2) ~ 500k, not 2.4M
		// Also, nextIndex advances monotonically, so total window activations is windows.length, not per sample
		expect(compiled.evaluationCount).toBeLessThan(totalSamples * 2);
		expect(compiled.evaluationCount).toBeGreaterThan(0);
		// Also ensure total evaluations is less than naive
		const naive = totalSamples * windows.length;
		expect(compiled.evaluationCount).toBeLessThan(naive / 2);
	});
});

/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening */
import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { planMixdown, planNestedMixdown } from '../media/render-plan';
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
		expect(e.duckStartSeconds).toBeCloseTo(0);
		expect(e.duckEndSeconds).toBeCloseTo(30 / fps);
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

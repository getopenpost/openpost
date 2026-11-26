/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening */
import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { planMixdown, planNestedMixdown } from '../media/render-plan';
import { collectMixEntryDuckWindows, mixEntryDuckGainAtTime } from './audio-ducking';

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
		expect(mixEntryDuckGainAtTime(0.25, targetEntry, allWindows)).toBeCloseTo(10 ** (-12 / 20));
		expect(mixEntryDuckGainAtTime(0.6, targetEntry, allWindows)).toBeCloseTo(1);
		const normalized = planMixdown(
			[
				item({ id: 'clamped', audioDucking: { duckOthersDb: -80 } }),
				item({ id: 'default', audioDucking: { duckOthersDb: -9 } }),
				item({
					id: 'ramps',
					audioDucking: { duckOthersDb: -9, attackSec: 0.5, releaseSec: 0.4 }
				})
			],
			[track('track-a')],
			fps
		);
		expect(collectMixEntryDuckWindows(normalized)[1]).toMatchObject({
			attackSeconds: 0.08,
			releaseSeconds: 0.25
		});
		expect(normalized.map((entry) => entry.ducking)).toEqual([
			{ duckOthersDb: -60 },
			{ duckOthersDb: -9 },
			{ duckOthersDb: -9, attackSec: 0.5, releaseSec: 0.4 }
		]);
	});
});

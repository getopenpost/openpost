import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { copyTimelineItems, planTimelineClipboardPaste } from './item-clipboard';

const tracks: TimelineTrack[] = [
	{
		id: 'V1',
		name: 'Video 1',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	},
	{
		id: 'A1',
		name: 'Audio 1',
		kind: 'audio',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 1
	}
];

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'video',
		trackId: 'V1',
		from: 30,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		...overrides
	};
}

describe('timeline item clipboard', () => {
	it('normalizes copied items to the earliest selected frame without sharing nested data', () => {
		const source = item({
			from: 90,
			effects: [{ id: 'fx', type: 'brightness', enabled: true, params: { amount: 0.2 } }]
		});
		const clipboard = copyTimelineItems([source, item({ id: 'later', from: 150 })]);

		expect(clipboard.map((entry) => entry.from)).toEqual([0, 60]);
		expect(clipboard[0]).not.toBe(source);
		expect(clipboard[0]?.effects).not.toBe(source.effects);
	});

	it('pastes a linked pair together after one shared collision shift', () => {
		const clipboard = copyTimelineItems([
			item({ linkedGroupId: 'pair' }),
			item({ id: 'audio', trackId: 'A1', type: 'audio', linkedGroupId: 'pair' })
		]);
		const existing = [
			item({ id: 'occupied-video', from: 100, durationInFrames: 40 }),
			item({ id: 'occupied-audio', trackId: 'A1', type: 'audio', from: 100, durationInFrames: 70 })
		];
		const ids = ['new-video', 'new-audio', 'new-link'];
		const pasted = planTimelineClipboardPaste({
			clipboard,
			currentFrame: 100,
			existingItems: existing,
			tracks,
			activeTrackId: 'V1',
			createId: () => ids.shift()!
		});

		expect(pasted.map((entry) => [entry.id, entry.trackId, entry.from])).toEqual([
			['new-video', 'V1', 170],
			['new-audio', 'A1', 170]
		]);
		expect(pasted[0]?.linkedGroupId).toBe('new-link');
		expect(pasted[1]?.linkedGroupId).toBe('new-link');
	});

	it('preserves gaps between transcript runs and creates independent origins', () => {
		const clipboard = copyTimelineItems([
			item({ id: 'first', from: 120 }),
			item({ id: 'second', from: 330 })
		]);
		const ids = ['paste-1', 'paste-2'];
		const pasted = planTimelineClipboardPaste({
			clipboard,
			currentFrame: 600,
			existingItems: [],
			tracks,
			activeTrackId: 'V1',
			createId: () => ids.shift()!
		});

		expect(pasted.map((entry) => entry.from)).toEqual([600, 810]);
		expect(pasted.map((entry) => entry.originId)).toEqual(['paste-1', 'paste-2']);
	});
});

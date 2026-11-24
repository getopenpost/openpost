import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { planMixdown, planNestedMixdown } from './render-plan';

function track(
	id: string,
	kind: 'video' | 'audio',
	order: number,
	extra: Partial<TimelineTrack> = {}
): TimelineTrack {
	return {
		id,
		name: id,
		kind,
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
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'video',
		...extra
	};
}

describe('planMixdown', () => {
	it('applies parent group mute without changing the child track state', () => {
		const group = track('dialogue-group', 'audio', 0, {
			kind: undefined,
			isGroup: true,
			muted: true
		});
		const child = track('dialogue', 'audio', 1, { parentTrackId: group.id });
		const entries = planMixdown(
			[item({ trackId: child.id, type: 'audio', mediaId: 'voice' })],
			[group, child],
			30
		);
		expect(entries).toEqual([]);
		expect(child.muted).toBe(false);
	});

	it('does not double schedule a linked visual and audio wrapper pair', () => {
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [
				item({
					id: 'leaf',
					type: 'audio',
					trackId: 'nested-audio',
					mediaId: 'voice',
					durationInFrames: 30
				})
			],
			tracks: [track('nested-audio', 'audio', 0)],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const wrappers = [
			item({
				id: 'visual-wrapper',
				type: 'composition',
				compositionId: 'nested',
				linkedGroupId: 'pair',
				mediaId: undefined,
				durationInFrames: 30
			}),
			item({
				id: 'audio-wrapper',
				type: 'audio',
				trackId: 'root-audio',
				compositionId: 'nested',
				linkedGroupId: 'pair',
				mediaId: undefined,
				durationInFrames: 30
			})
		];
		const entries = planNestedMixdown(
			wrappers,
			[track('track-video-main', 'video', 0), track('root-audio', 'audio', 1)],
			30,
			[],
			[nested]
		);
		expect(entries.map((entry) => entry.itemId)).toEqual(['audio-wrapper/leaf']);
	});
});

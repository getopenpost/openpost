import { describe, expect, it } from 'vitest';
import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import {
	applyMixEntryGain,
	frameToSourceSeconds,
	isVisibleAtFrame,
	outputDurationFrames,
	paintOrder,
	planMixdown,
	planNestedMixdown,
	selectCuesAtFrame,
	sliceMixEntries,
	transitionBlendAtFrame
} from './render-plan';

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

describe('outputDurationFrames', () => {
	it('scales by speed and respects a different source fps', () => {
		const clip = item({ sourceStart: 0, sourceFps: 60, speed: 2 });
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(2);
		expect(frameToSourceSeconds(clip, 15, 30)).toBeCloseTo(1);
	});

	it('maps reversed clips from the exclusive source end toward the source start', () => {
		const clip = item({
			from: 10,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 180,
			sourceFps: 60,
			speed: 2,
			isReversed: true
		});
		expect(frameToSourceSeconds(clip, 10, 30)).toBeCloseTo(179 / 60);
		expect(frameToSourceSeconds(clip, 25, 30)).toBeCloseTo(119 / 60);
		expect(frameToSourceSeconds(clip, 40, 30)).toBeCloseTo(59 / 60);
	});

	it('maps a persisted variable-speed curve to the same source frames used by export', () => {
		const clip = item({
			durationInFrames: 90,
			sourceStart: 0,
			sourceEnd: 120,
			sourceFps: 30,
			speed: 1,
			speedRamp: [
				{ id: 'normal-in', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
				{ id: 'normal-out', sourceFrame: 90, speed: 1, easing: 'hold' },
				{ id: 'end', sourceFrame: 120, speed: 1, easing: 'linear' }
			]
		});

		expect(frameToSourceSeconds(clip, 0, 30)).toBeCloseTo(0);
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(1);
		expect(frameToSourceSeconds(clip, 60, 30)).toBeCloseTo(3);
		expect(frameToSourceSeconds(clip, 90, 30)).toBeCloseTo(4);
	});
});

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

	it('stops recursive cycles while still scheduling reachable leaves once', () => {
		const cycle: SubComposition = {
			id: 'cycle',
			name: 'Cycle',
			items: [
				item({
					id: 'leaf',
					type: 'audio',
					trackId: 'cycle-audio',
					mediaId: 'voice',
					durationInFrames: 30
				}),
				item({
					id: 'self',
					type: 'audio',
					trackId: 'cycle-audio',
					mediaId: undefined,
					compositionId: 'cycle',
					durationInFrames: 30
				})
			],
			tracks: [track('cycle-audio', 'audio', 0)],
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 30
		};
		const entries = planNestedMixdown(
			[
				item({
					id: 'root-wrapper',
					type: 'audio',
					trackId: 'root-audio',
					mediaId: undefined,
					compositionId: 'cycle',
					durationInFrames: 30
				})
			],
			[track('root-audio', 'audio', 0)],
			30,
			[],
			[cycle]
		);
		expect(entries.map((entry) => entry.mediaId)).toEqual(['voice']);
	});
});

describe('transitionBlendAtFrame', () => {
	const clips = new Map([
		['left', item({ id: 'left', from: 0, durationInFrames: 100 })],
		['right', item({ id: 'right', from: 100, durationInFrames: 100 })]
	]);
	const transitions: TimelineTransition[] = [
		{
			id: 't',
			type: 'crossfade',
			durationInFrames: 20,
			fromItemId: 'left',
			toItemId: 'right'
		}
	];

	it('omits items on hidden tracks from the visual plan', () => {
		const tracks = [track('shown', 'video', 0), track('hidden', 'video', 1, { visible: false })];
		const ordered = paintOrder(
			[
				item({ id: 'shown-item', trackId: 'shown' }),
				item({ id: 'hidden-item', trackId: 'hidden' })
			],
			tracks
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['shown-item']);
	});

	it('renders only solo tracks when any track is soloed', () => {
		const ordered = paintOrder(
			[item({ id: 'normal-item', trackId: 'normal' }), item({ id: 'solo-item', trackId: 'solo' })],
			[track('normal', 'video', 0), track('solo', 'video', 1, { solo: true })]
		);

		expect(ordered.map((entry) => entry.id)).toEqual(['solo-item']);
	});
});

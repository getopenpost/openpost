import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	canvasNudgePatch,
	isRateStretchableType,
	loopingStretchSpeed,
	planCanvasNudge,
	planLinkedSlipGesture,
	planRateStretchGesture,
	planSlideGesture
} from './edit-gesture';

function video(
	id: string,
	trackId: string,
	from: number,
	durationInFrames: number,
	extra: Partial<TimelineItem> = {}
): TimelineItem {
	return {
		id,
		trackId,
		from,
		durationInFrames,
		label: id,
		type: 'video',
		...extra
	};
}

describe('rate-stretch gesture parity', () => {
	it('treats video, audio, composition, and looping GIFs as stretchable only', () => {
		expect(isRateStretchableType(video('v', 't', 0, 10))).toBe(true);
		expect(isRateStretchableType({ ...video('a', 't', 0, 10), type: 'audio' })).toBe(true);
		expect(isRateStretchableType({ ...video('c', 't', 0, 10), type: 'composition' })).toBe(true);
		expect(
			isRateStretchableType({ ...video('g', 't', 0, 10), type: 'image', label: 'loop.gif' })
		).toBe(true);
		expect(
			isRateStretchableType({ ...video('s', 't', 0, 10), type: 'image', label: 'still.png' })
		).toBe(false);
		expect(isRateStretchableType({ ...video('x', 't', 0, 10), type: 'text' })).toBe(false);
	});

	it('snaps the stretched edge to a nearby item boundary', () => {
		const item = video('clip', 't', 0, 100, {
			sourceStart: 0,
			sourceEnd: 200,
			sourceFps: 30
		});
		const plan = planRateStretchGesture(
			item,
			'end',
			18,
			[item],
			30,
			[{ frame: 120, type: 'item-start', itemId: 'other' }],
			5
		);
		expect(plan?.patch.durationInFrames).toBe(120);
		expect(plan?.patch.speed).toBeCloseTo(200 / 120, 5);
		expect(plan?.snapTarget).toEqual({ frame: 120, type: 'item-start', itemId: 'other' });
	});

	it('caps the stretched duration at the speed limits', () => {
		const item = video('clip', 't', 0, 100, {
			sourceStart: 0,
			sourceEnd: 200,
			sourceFps: 30
		});
		const stretched = planRateStretchGesture(item, 'end', 100_000, [item], 30, [], 1);
		expect(stretched?.patch.durationInFrames).toBe(2000);
		expect(stretched?.patch.speed).toBe(0.1);
		const compressed = planRateStretchGesture(item, 'end', -95, [item], 30, [], 1);
		expect(compressed?.patch.durationInFrames).toBe(13);
		expect(compressed?.patch.speed).toBeCloseTo(200 / 13, 5);
	});

	it('changes only speed for looping GIFs, keeping duration fixed', () => {
		const item = video('gif', 't', 0, 100, {
			type: 'image',
			label: 'loop.gif',
			speed: 1
		});
		const plan = planRateStretchGesture(item, 'end', 30, [item], 30, [], 1);
		expect(plan?.patch.speed).toBe(0.9);
		expect('durationInFrames' in (plan?.patch ?? {})).toBe(false);
	});

	it('refuses non-stretchable kinds', () => {
		const item = video('caption', 't', 0, 100, { type: 'text' });
		expect(planRateStretchGesture(item, 'end', 10, [item], 30, [], 1)).toBeNull();
	});

	it('derives looping speed directionally and clamps it to the speed limits', () => {
		expect(loopingStretchSpeed(1, 30)).toBe(0.9);
		expect(loopingStretchSpeed(1, -30)).toBe(1.1);
		expect(loopingStretchSpeed(1, -100_000)).toBe(16);
		expect(loopingStretchSpeed(1, 100_000)).toBe(0.1);
	});
});

describe('canvas-pixel nudge parity', () => {
	it('nudges visual transforms and skips timeline-only kinds', () => {
		const visual = video('v', 't', 0, 10, { transform: { x: 5, y: 0 } });
		expect(canvasNudgePatch(visual, 1, 0)?.transform).toMatchObject({ x: 6, y: 0 });
		expect(canvasNudgePatch({ ...visual, type: 'audio' }, 1, 0)).toBeNull();
		expect(canvasNudgePatch({ ...visual, type: 'adjustment' }, 0, 1)).toBeNull();
		expect(canvasNudgePatch({ ...visual, type: 'controller' }, 0, 1)).toBeNull();
	});

	it('nudges every selected visual item, or just the focused one outside the selection', () => {
		const items = [
			video('v1', 't', 0, 10),
			video('a1', 't', 0, 10, { type: 'audio' }),
			video('v2', 't', 10, 10)
		];
		const selected = planCanvasNudge(items, ['v1', 'a1', 'v2'], 'v1', 1, 0);
		expect(selected.map((update) => update.id).sort()).toEqual(['v1', 'v2']);
		const focused = planCanvasNudge(items, ['v1'], 'v2', 0, -1);
		expect(focused.map((update) => update.id)).toEqual(['v2']);
		expect(focused[0]?.patch.transform).toMatchObject({ x: 0, y: -1 });
	});
});

describe('slip and slide preservation parity', () => {
	it('slides no earlier than the timeline start', () => {
		const item = video('clip', 't', 5, 20, { sourceStart: 0, sourceEnd: 20 });
		const plan = planSlideGesture(item, null, null, -10, [item], 30, [], 1);
		expect(plan.itemPatch.from).toBe(0);
	});

	it('holds a slide when the adjacent neighbor has no source handle left', () => {
		const left = video('left', 't', 0, 50, {
			sourceStart: 0,
			sourceEnd: 50,
			sourceDuration: 50
		});
		const item = video('clip', 't', 50, 20, { sourceStart: 0, sourceEnd: 20 });
		const plan = planSlideGesture(item, left, null, 10, [left, item], 30, [], 1);
		expect(plan.itemPatch.from).toBe(50);
	});

	it('slips within source bounds without touching timeline keyframes', () => {
		const item = video('clip', 't', 0, 20, {
			sourceStart: 10,
			sourceEnd: 30,
			sourceDuration: 100,
			keyframes: {}
		});
		const updates = planLinkedSlipGesture(item, -5, [item], 30);
		const anchor = updates.find((update) => update.id === item.id);
		expect(anchor?.patch.sourceStart).toBe(15);
		expect(anchor?.patch.sourceEnd).toBe(35);
		expect('keyframes' in (anchor?.patch ?? {})).toBe(false);
		const clamped = planLinkedSlipGesture(item, -1000, [item], 30);
		expect(clamped.find((update) => update.id === item.id)?.patch.sourceStart).toBe(80);
	});
});

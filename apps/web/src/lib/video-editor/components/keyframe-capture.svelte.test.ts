import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import { editorKeyframes, editorPropertyLabel } from '../timeline/keyframe-editor';
import type { KeyframeProperty, TimelineItem } from '../project/types';
import KeyframeDopesheet from './keyframe-dopesheet.svelte';
import { m } from '$lib/paraglide/messages';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	sequenceStore.reset();
});

it.each([
	{ property: 'fontSize', patch: { type: 'text', fontSize: 72 }, expected: 72 },
	{ property: 'volume', patch: { type: 'audio', volume: 0.25 }, expected: 0.25 },
	{
		property: 'cropLeft',
		patch: {
			type: 'video',
			sourceWidth: 1920,
			sourceHeight: 1080,
			crop: { left: 0.1, right: 0, top: 0, bottom: 0 }
		},
		expected: 192
	},
	{
		property: 'width',
		patch: { type: 'video', sourceWidth: 1280, sourceHeight: 720 },
		expected: 1280
	},
	{ property: 'width', patch: { type: 'text' }, expected: 1080 },
	{ property: 'anchorX', patch: { type: 'text' }, expected: 540 },
	{ property: 'trimPathEnd', patch: { type: 'shape', shapeType: 'rectangle' }, expected: 100 }
] satisfies Array<{ property: KeyframeProperty; patch: Partial<TimelineItem>; expected: number }>)(
	'captures the current $property value when creating its first keyframe',
	async ({ property, patch, expected }) => {
		const item: TimelineItem = {
			id: 'capture',
			trackId: 'visual',
			from: 30,
			durationInFrames: 90,
			label: 'Capture',
			...patch
		};
		sequenceStore._setRootResolution({ width: 1080, height: 1920, fps: 30 });
		timelineStore._setItems([item]);
		const screen = await render(KeyframeDopesheet, {
			item,
			availableProperties: [property],
			currentFrame: 45,
			pixelsPerFrame: 5,
			timelineWidth: 1000,
			timelineX: (frame: number) => frame * 5,
			onscrub: vi.fn(),
			onselect: vi.fn(),
			onedit: vi.fn()
		});
		await screen
			.getByRole('button', { name: m.video_editor_keyframe_sheet_keyframed_only(), exact: true })
			.click();
		await screen
			.getByRole('button', {
				name: m.video_editor_keyframe_sheet_add({ property: editorPropertyLabel(item, property) }),
				exact: true
			})
			.click();
		expect(editorKeyframes(timelineStore.itemById.get(item.id)!, property)).toMatchObject([
			{ frame: 15, value: property === 'width' ? 100 : expected }
		]);
		if (patch.type === 'text' && property === 'width')
			expect(
				resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 45).transform?.height
			).toBe(1920);
		if (property === 'anchorX')
			expect(
				resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 45).transform?.anchorY
			).toBe(960);
		commandHistory.undo();
		expect(editorKeyframes(timelineStore.itemById.get(item.id)!, property)).toEqual([]);
	}
);

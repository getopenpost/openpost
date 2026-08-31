import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createEmptyTimeline } from '$lib/video-editor/project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import '../../../routes/layout.css';
import CompositionControlOverrides from './composition-control-overrides.svelte';
import CompositionControlsAuthoring from './composition-controls-authoring.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const title: TimelineItem = {
	id: 'title',
	trackId: track.id,
	from: 0,
	durationInFrames: 30,
	label: 'Title',
	type: 'text',
	text: 'Source title',
	color: '#ffffff'
};

function composition(withControls = false): SubComposition {
	return {
		id: 'card',
		name: 'Card',
		editorKind: 'composite-2d',
		items: [title],
		tracks: [track],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 30,
		compositionControls: withControls
			? {
					version: 1,
					controls: [
						{
							id: 'headline',
							name: 'Headline',
							targetItemId: title.id,
							property: 'text.text',
							kind: 'text',
							defaultValue: 'Source title'
						}
					]
				}
			: undefined
	};
}

beforeEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('publishes a source property from an active Motion composition', async () => {
	sequenceStore.load(
		{ ...createEmptyTimeline(), compositions: [composition()] },
		{ width: 1920, height: 1080, fps: 30 }
	);
	sequenceStore.switchTo('card');
	const onedit = vi.fn();
	const screen = await render(CompositionControlsAuthoring, { onedit });

	await screen.getByRole('button', { name: 'Property to expose' }).click();
	await screen.getByRole('option', { name: 'Title - Text', exact: true }).click();
	await screen.getByRole('button', { name: 'Expose property' }).click();

	expect(sequenceStore.compositionById.get('card')?.compositionControls?.controls[0]).toMatchObject(
		{
			name: 'Title',
			targetItemId: 'title',
			property: 'text.text'
		}
	);
	expect(onedit).toHaveBeenCalledOnce();
});

test('edits and resets one reusable composition instance', async () => {
	const wrapper: TimelineItem = {
		id: 'instance',
		trackId: track.id,
		from: 0,
		durationInFrames: 30,
		label: 'Card',
		type: 'composition',
		compositionId: 'card'
	};
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks: [track],
			items: [wrapper],
			compositions: [composition(true)]
		},
		{ width: 1920, height: 1080, fps: 30 }
	);
	const onedit = vi.fn();
	const screen = await render(CompositionControlOverrides, {
		item: wrapper,
		onedit
	});
	const input = screen.getByRole('textbox', { name: 'Headline' });

	await input.fill('Instance title');
	await input.element().blur();
	expect(timelineStore.itemById.get(wrapper.id)?.compositionControlOverrides).toEqual({
		headline: 'Instance title'
	});

	await screen.getByRole('button', { name: 'Reset Headline' }).click();
	expect(timelineStore.itemById.get(wrapper.id)?.compositionControlOverrides).toBeUndefined();
	expect(onedit).toHaveBeenCalledTimes(2);
});

test('keeps published control authoring inside a phone viewport', async () => {
	await page.viewport(320, 720);
	sequenceStore.load(
		{ ...createEmptyTimeline(), compositions: [composition(true)] },
		{ width: 1920, height: 1080, fps: 30 }
	);
	sequenceStore.switchTo('card');
	const screen = await render(CompositionControlsAuthoring, {
		onedit: vi.fn()
	});
	const section = screen
		.getByRole('heading', { name: 'Published controls (1)' })
		.element().parentElement;

	expect(section).not.toBeNull();
	if (!section) return;
	expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});

import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { COMPOSITION_CONTROLS_VERSION } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import CompositionTimeline from './composition-timeline.svelte';

it('changes composition zoom through the accessible scalar slider', async () => {
	const previousZoom = timelineStore.zoomLevel;
	const compositionId = 'composition-zoom-test';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Zoom test',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 120
	});
	sequenceStore.switchTo(compositionId);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const slider = screen.getByRole('slider', {
			name: m.video_editor_composition_timeline_zoom()
		});
		slider.element().focus();
		await userEvent.keyboard('{ArrowRight}');

		await vi.waitFor(() => expect(timelineStore.zoomLevel).toBeGreaterThan(1));
	} finally {
		sequenceStore.deleteCompositionAndReferences(compositionId);
		timelineStore._setZoomLevel(previousZoom);
	}
});

it('keeps an explicit accessible name on composition control override fields while typing', async () => {
	const nestedId = 'composition-nested-control-label';
	const parentId = 'composition-parent-control-label';
	const instanceId = 'composition-instance-control-label';
	sequenceStore.addComposition({
		id: nestedId,
		name: 'Nested promo',
		editorKind: 'composite-2d',
		items: [
			{
				id: 'nested-text-control-label',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60,
				label: 'Nested title',
				type: 'text',
				text: 'Hello',
				fontFamily: 'Inter',
				fontSize: 64,
				fontWeight: 700,
				color: '#ffffff',
				transform: { x: 0, y: 0, width: 960, height: 240 }
			}
		],
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60,
		compositionControls: {
			version: COMPOSITION_CONTROLS_VERSION,
			controls: [
				{
					id: 'ctrl-headline-label',
					name: 'Headline',
					targetItemId: 'nested-text-control-label',
					property: 'text.text',
					kind: 'text',
					defaultValue: 'Hello'
				}
			]
		}
	});
	sequenceStore.addComposition({
		id: parentId,
		name: 'Parent promo',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(parentId);
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: instanceId,
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Promo block',
			type: 'composition',
			compositionId: nestedId
		}
	]);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		screen.container
			.querySelector<HTMLButtonElement>(`[data-testid="layer-expand-${instanceId}"]`)!
			.click();
		const field = screen.getByRole('textbox', { name: 'Headline' });
		await expect.element(field).toHaveAttribute('aria-label', 'Headline');
		await field.fill('New headline');
		await expect.element(field).toHaveValue('New headline');
		await expect.element(field).toHaveAttribute('aria-label', 'Headline');
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(parentId);
		sequenceStore.deleteCompositionAndReferences(nestedId);
	}
});
